#include "app.h"
#include "api.h"
#include "settings.h"
#include "protocol.h"
#include "recording_controls.h"
#include "nfc_peer.h"
#include "tls_roots.h"
#include <M5Unified.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_heap_caps.h>
#include <ctime>
#include <cmath>
#include <algorithm>

namespace {
#ifndef COCO_API_BASE
#define COCO_API_BASE ""
#endif
constexpr char kBase[]=COCO_API_BASE;
portMUX_TYPE uiLock=portMUX_INITIALIZER_UNLOCKED;
Ui ui{Mode::Offline,"USB provisioning needed"};
struct Upload { uint8_t* bytes; size_t size; uint32_t queuedAt; coco::CaptureKind kind; };
struct Playback { uint8_t* bytes; size_t size; };
QueueHandle_t uploads=nullptr,playbacks=nullptr,playbackResults=nullptr;
uint8_t* capture=nullptr;
size_t completed=0;
size_t captureLimit=0;
uint32_t captureStart=0;
bool stopping=false,selfTest=false,warming=false;
std::atomic<uint8_t> capturePhase{0}; // 1: codec warm-up, 2: microphone capture
std::atomic<coco::CaptureKind> captureKind{coco::CaptureKind::Voice};
std::atomic<uint32_t> recordingLimit{0},recordingSeconds{0},activeSeconds{15};
coco::BlueButton blueButton;
uint32_t warmUntil=0;
constexpr size_t chunk=1600;
String currentJob;
coco::CaptureKind jobKind=coco::CaptureKind::Voice;
String lastRecordingJob;
uint32_t jobStarted=0;
int lastStatus=0;
bool connected=false;
std::atomic<bool> online{false};
char replyText[241]="Hold blue A: talk. Double-tap A: record. Gray B: tap.";
void saveReply(const char* text) {portENTER_CRITICAL(&uiLock);strlcpy(replyText,text?text:"",sizeof(replyText));portEXIT_CRITICAL(&uiLock);}
void showReply(Mode mode) {char copy[sizeof(replyText)];portENTER_CRITICAL(&uiLock);memcpy(copy,replyText,sizeof(copy));portEXIT_CRITICAL(&uiLock);setUi(mode,copy);}
String handled[32]; unsigned handledNext=0;
Preferences ledger;

bool transient(int status) { return status<=0 || status==408 || status==429 || status>=500; }
void httpSetup(HTTPClient& http,WiFiClientSecure& client,const String& path) {
  client.setCACert(COCO_ROOTS);
  client.setHandshakeTimeout(12);
  http.begin(client,String(kBase)+path);
  http.setConnectTimeout(8000); http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.addHeader("Authorization","Bearer "+settings.token);
}
void networkError(int status) {
  char text[80]; snprintf(text,sizeof(text),"API %d. Check connection.",status);
  setUi(status<=0?Mode::Offline:Mode::Error,text);
  Serial.printf("COCO_API_ERROR status=%d\n",status);
}
bool clockReady() { return time(nullptr)>1767225600; }
bool wasHandled(const String& id) {
  for(const auto& v:handled) if(v==id)return true;
  return false;
}
bool remember(const String& id) {
  const String key="c"+String(handledNext);
  if(ledger.putString(key.c_str(),id)!=id.length())return false;
  handled[handledNext]=id;handledNext=(handledNext+1)%32;
  ledger.putUInt("next",handledNext);return true;
}
bool ack(const String& id) {
  JsonDocument req,out;req["requestId"]="ack_"+id;
  String body;serializeJson(req,body);
  return apiJson("POST","/v1/device/commands/"+id+"/ack",body,out);
}
class BoundedBuffer : public Stream {
 public:
  uint8_t* bytes;size_t length=0,capacity;
  explicit BoundedBuffer(size_t cap):capacity(cap) {bytes=(uint8_t*)ps_malloc(cap);}
  ~BoundedBuffer(){free(bytes);}
  size_t write(uint8_t b) override {return write(&b,1);}
  size_t write(const uint8_t* p,size_t n) override {
    if(!bytes || n>capacity-length)return 0;
    memcpy(bytes+length,p,n);length+=n;return n;
  }
  int available() override{return 0;} int read() override{return -1;}
  int peek() override{return -1;} void flush() override{}
};
enum class PlayResult { Played, Busy, Retry, Failed };
PlayResult playAudio(const String& id) {
  if(!coco::safeId(id.c_str()))return PlayResult::Failed;
  if(audioBusy.exchange(true))return PlayResult::Busy;
  bool ok=false,permanent=false;
  {
    WiFiClientSecure client;HTTPClient http;httpSetup(http,client,"/v1/audio/"+id);
    int status=http.GET();
    const int size=http.getSize();
    permanent=status==404 || status==410 || (status==200 && (size==0 || size>int(coco::kMaxReplyBytes)));
    if(status==200 && size!=0 && size<=int(coco::kMaxReplyBytes)) {
      BoundedBuffer data(size>0?size:coco::kMaxReplyBytes);
      const int received=data.bytes?http.writeToStream(&data):-1;
      coco::Wav w;
      const bool complete=received>0 && (size<0 || received==size);
      if(complete && !coco::parseWav(data.bytes,data.length,w))permanent=true;
      if(received>0 && (size<0 || received==size) && coco::parseWav(data.bytes,data.length,w)) {
        Playback p{data.bytes,data.length}; bool played=false;
        http.end();
        if(xQueueSend(playbacks,&p,0)==pdTRUE) {
          data.bytes=nullptr;
          // Audio worker is the main loop; leave it ownership until its completion result.
          if(xQueueReceive(playbackResults,&played,pdMS_TO_TICKS(150000))==pdTRUE)ok=played;
        }
      }
    }
    http.end();
  }
  audioBusy=false;
  if(!ok)showReply(Mode::Idle);
  return ok?PlayResult::Played:permanent?PlayResult::Failed:PlayResult::Retry;
}
struct AudioAttempt {String id;unsigned failures=0;uint32_t retryAt=0;};
AudioAttempt attempts[16];unsigned attemptNext=0;
AudioAttempt& attemptFor(const String& id) {
  for(auto& item:attempts)if(item.id==id)return item;
  auto& item=attempts[attemptNext++%16];item.id=id;item.failures=0;item.retryAt=0;return item;
}
void commands() {
  if(capturePhase.load() || (currentJob.length() && jobKind==coco::CaptureKind::Recording))return;
  JsonDocument d;
  if(!apiJson("GET","/v1/device/commands","",d))return;
  for(JsonVariantConst command:d["commands"].as<JsonArrayConst>()) {
    if(capturePhase.load())return;
    const String id=command["id"]|"";
    if(!coco::safeId(id.c_str(),1,90))continue;
    if(wasHandled(id)) {ack(id);continue;}
    const String type=command["type"]|"";
    auto p=command["payload"];
    bool done=false;
    if(type=="display") {
      const String mode=p["mode"]|"";
      Mode m=mode=="coffee"?Mode::Coffee:mode=="lunch"?Mode::Lunch:mode=="meeting"?Mode::Meeting:Mode::Idle;
      const String text=p["text"]|"";
      const bool recordingReply=lastRecordingJob.length() && p["jobId"].as<String>()==lastRecordingJob;
      saveReply(recordingReply?(String("Recording saved. ")+text).c_str():text.c_str());showReply(m);done=true;
      if(coco::safeId(p["encounterId"]))Serial.printf("COCO_ENCOUNTER_DISPLAY id=%s\n",p["encounterId"].as<const char*>());
    } else if(type=="speak") {
      if(nfcArmed())continue; // Confirmation must not wait behind a long audio download or playback.
      auto& attempt=attemptFor(id);
      if(int32_t(millis()-attempt.retryAt)<0)continue;
      saveReply(p["text"]|"Speech unavailable");showReply(Mode::Thinking);
      const String audio=p["audioId"]|"";
      const auto result=audio.length()?playAudio(audio):PlayResult::Failed;
      done=result==PlayResult::Played;
      if(result==PlayResult::Failed || (result==PlayResult::Retry && ++attempt.failures>=3)) {
        // Text fallback is handled; ack does not claim that playback succeeded.
        Serial.printf("COCO_AUDIO_TEXT_FALLBACK command=%s\n",id.c_str());showReply(Mode::Idle);done=true;
      } else if(result==PlayResult::Retry)attempt.retryAt=millis()+(1000U<<attempt.failures);
    } else if(type=="encounter_offer") {
      done=handleEncounter(command);
    }
    if(done && remember(id))ack(id);
  }
}
bool upload(Upload data,const String& id) {
  for(unsigned attempt=0;attempt<3;++attempt) {
    if(WiFi.status()!=WL_CONNECTED) {lastStatus=-1;break;}
    WiFiClientSecure client;HTTPClient http;httpSetup(http,client,coco::capturePath(data.kind));
    if(data.kind==coco::CaptureKind::Recording)http.setTimeout(60000);
    http.addHeader("Content-Type","audio/wav");http.addHeader("X-Request-Id",id);
    const int status=http.POST(data.bytes,data.size);lastStatus=status;
    JsonDocument d;
    bool ok=status==202 && !deserializeJson(d,http.getString()) && coco::safeId(d["jobId"]);
    if(ok) {currentJob=d["jobId"].as<String>();jobKind=data.kind;jobStarted=millis();Serial.printf("COCO_%s_JOB id=%s\n",data.kind==coco::CaptureKind::Recording?"RECORDING":"VOICE",currentJob.c_str());}
    http.end();
    Serial.printf("COCO_%s_UPLOAD status=%d bytes=%u attempt=%u\n",data.kind==coco::CaptureKind::Recording?"RECORDING":"VOICE",status,unsigned(data.size),attempt+1);
    if(ok)return true;
    if(!transient(status))break;
    vTaskDelay(pdMS_TO_TICKS(1000U<<attempt));
  }
  return false;
}
void pollJob() {
  if(!currentJob.length())return;
  JsonDocument d;
  if(!apiJson("GET","/v1/jobs/"+currentJob,"",d))return;
  const String status=d["status"]|"";
  if(status=="failed") {
    setUi(Mode::Error,d["error"]["message"]|(jobKind==coco::CaptureKind::Recording?"Recording could not be saved":"Voice request failed"));
    Serial.printf("COCO_JOB_FAILED code=%s\n",d["error"]["code"]|"unknown");
    currentJob="";audioBusy=false;
  } else if(status=="completed") {
    const String text=d["result"]["text"]|"";
    if(jobKind==coco::CaptureKind::Recording) {
      lastRecordingJob=currentJob;
      saveReply((String("Recording saved. ")+(text.length()?text:"Open the portal for transcript and summary.")).c_str());
    } else saveReply(text.length()?text.c_str():"Reply ready");
    showReply(Mode::Idle);
    Serial.printf("COCO_JOB_COMPLETED kind=%s audio=%u\n",coco::capturePrefix(jobKind),d["result"]["audioId"].is<String>());
    currentJob="";audioBusy=false;
    // Server command queue is the only playback path, preventing double speech.
  } else if(millis()-jobStarted>300000) {
    setUi(Mode::Error,"Still processing. Check the portal.");currentJob="";audioBusy=false;
  }
}
void networkTask(void*) {
  if (!*kBase) {
    setUi(Mode::Offline, "No API configured");
    vTaskDelete(nullptr);
    return;
  }
  ledger.begin("coco_commands",false);handledNext=ledger.getUInt("next",0)%32;
  for(unsigned i=0;i<32;++i)handled[i]=ledger.getString(("c"+String(i)).c_str());
  WiFi.onEvent([](WiFiEvent_t event,WiFiEventInfo_t info) {
    if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED)Serial.printf("COCO_WIFI_DISCONNECTED reason=%u\n",info.wifi_sta_disconnected.reason);
    if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP)Serial.println("COCO_WIFI_CONNECTED");
  });
  WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.setAutoReconnect(true);
  int networks=WiFi.scanNetworks();bool found=false;
  for(int i=0;i<networks;++i)if(WiFi.SSID(i)==settings.ssid) {
    found=true;Serial.printf("COCO_WIFI_NETWORK found=1 channel=%d rssi=%d auth=%d\n",WiFi.channel(i),WiFi.RSSI(i),WiFi.encryptionType(i));
  }
  if(!found)Serial.println("COCO_WIFI_NETWORK found=0");
  WiFi.scanDelete();WiFi.begin(settings.ssid.c_str(),settings.password.c_str());
  uint32_t nextPoll=0,nextConnect=millis()+20000;unsigned failures=0;
  bool clockStarted=false;
  for(;;) {
    const uint32_t now=millis();
    online=connected && WiFi.status()==WL_CONNECTED && clockReady();
    Upload waiting{};
    if(xQueuePeek(uploads,&waiting,0)==pdTRUE && now-waiting.queuedAt>15000) {
      if(xQueueReceive(uploads,&waiting,0)==pdTRUE)free(waiting.bytes);
      audioBusy=false;setUi(Mode::Offline,"Not saved: connection unavailable");Serial.printf("COCO_%s_DROPPED_OFFLINE\n",waiting.kind==coco::CaptureKind::Recording?"RECORDING":"VOICE");
    }
    if(currentJob.length() && now-jobStarted>300000) {currentJob="";audioBusy=false;setUi(Mode::Error,"Still processing. Check the portal.");}
    if(WiFi.status()!=WL_CONNECTED) {
      connected=false;
      if(int32_t(now-nextConnect)>=0) {setUi(Mode::Offline,"Connecting to Wi-Fi");WiFi.reconnect();nextConnect=now+15000;}
      vTaskDelay(pdMS_TO_TICKS(100));continue;
    }
    if(!clockStarted) {configTime(0,0,"time.google.com","pool.ntp.org");clockStarted=true;}
    if(!clockReady()) {setUi(Mode::Offline,"Setting clock for HTTPS");vTaskDelay(pdMS_TO_TICKS(500));continue;}
    if(!connected) {
      if(int32_t(now-nextPoll)<0) {vTaskDelay(pdMS_TO_TICKS(50));continue;}
      JsonDocument d;
      if(apiJson("GET","/v1/bootstrap","",d) && d["me"]["deviceId"].as<String>()==settings.deviceId &&
         d["me"]["nfcToken"].as<String>()==settings.nfcToken) {
        const uint32_t serverLimit=d["capabilities"]["maxRecordingSeconds"]|0U;
        recordingLimit=d["capabilities"]["shortRecording"]==true?std::min(serverLimit,coco::kMaxRecordingSeconds):0;
        connected=true;online=true;failures=0;setUi(Mode::Idle,"Hold blue A: talk. Double-tap A: record. Gray B: tap.");Serial.println("COCO_BOOTSTRAP_OK");
      } else {setUi(Mode::Error,"Provisioning or API check failed");nextPoll=now+15000;continue;}
    }
    Upload clip{};
    if(xQueueReceive(uploads,&clip,0)==pdTRUE) {
      const bool recording=clip.kind==coco::CaptureKind::Recording;
      setUi(recording?Mode::Saving:Mode::Uploading,recording?"Uploading recording":"Sending your voice");
      const bool ok=upload(clip,requestId(coco::capturePrefix(clip.kind)));free(clip.bytes);
      if(ok)setUi(recording?Mode::Saving:Mode::Thinking,recording?"Preparing transcript and summary":"Coco is thinking");else {networkError(lastStatus);audioBusy=false;}
    }
    updateEncounters();
    // Never overwrite the listening UI or attempt speaker access during capture.
    if(!capturePhase.load() && int32_t(now-nextPoll)>=0) {
      pollJob();commands();
      failures=lastStatus>=200 && lastStatus<300?0:std::min(failures+1,5U);
      uint32_t interval=failures?std::min(1000U<<failures,30000U):(nfcArmed()?1000:currentJob.length()?1500:5000);
      nextPoll=millis()+interval;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}
void abortCapture(Mode mode,const char* message) {
  M5.Mic.end();free(capture);capture=nullptr;
  selfTest=false;warming=false;stopping=false;completed=0;capturePhase=0;
  setUi(mode,message);audioBusy=false;
}
void finishCapture() {
  M5.Mic.end();capturePhase=0;
  const bool recording=captureKind.load()==coco::CaptureKind::Recording;
  if(completed<1600) {abortCapture(Mode::Idle,recording?"Recording too short. Nothing saved.":"Hold A while speaking");return;}
  coco::wavHeader(capture,completed);
  int peak=0;double squares=0;size_t nonzero=0;
  auto pcm=reinterpret_cast<int16_t*>(capture+44);
  for(size_t i=0;i<completed;++i) {int v=pcm[i];peak=std::max(peak,abs(v));squares+=double(v)*v;nonzero+=(v!=0);}
  Serial.printf("COCO_CAPTURE kind=%s samples=%u rate=16000 peak=%d rms=%.1f nonzero=%u\n",coco::capturePrefix(captureKind.load()),unsigned(completed),peak,sqrt(squares/completed),unsigned(nonzero));
  if(selfTest) {
    Playback p{capture,44+completed*2};
    if(xQueueSend(playbacks,&p,0)!=pdTRUE) {abortCapture(Mode::Error,"Playback queue busy");return;}
    setUi(Mode::Speaking,"Playing microphone test");
  } else {
    Upload u{capture,44+completed*2,millis(),captureKind.load()};
    if(xQueueSend(uploads,&u,0)!=pdTRUE) {abortCapture(Mode::Error,"Upload queue busy");return;}
    else setUi(recording?Mode::Saving:Mode::Uploading,recording?"Saving recording":"Sending your voice");
  }
  capture=nullptr;
}
void beginCapture(coco::CaptureKind kind,bool test=false) {
  if(!test && !online.load()) {setUi(Mode::Offline,"Offline. Connect before recording.");return;}
  if(kind==coco::CaptureKind::Recording && !recordingLimit.load()) {setUi(Mode::Error,"Short recording unavailable");return;}
  if(kind==coco::CaptureKind::Recording && nfcArmed()) {setUi(Mode::Idle,"Finish the badge tap before recording");return;}
  if(audioBusy.exchange(true))return;
  captureLimit=coco::captureSamples(kind,recordingLimit.load());activeSeconds=coco::captureSeconds(kind,recordingLimit.load());
  capture=(uint8_t*)ps_malloc(44+captureLimit*2);
  if(!capture) {abortCapture(Mode::Error,"Audio memory unavailable");return;}
  captureKind=kind;recordingSeconds=0;selfTest=test;completed=0;stopping=false;warming=true;
  M5.Speaker.end();auto cfg=M5.Mic.config();cfg.sample_rate=16000;cfg.stereo=false;M5.Mic.config(cfg);
  if(!M5.Mic.begin()) {abortCapture(Mode::Error,"Microphone unavailable");return;}
  // Codec warm-up is outside either capture's sample and duration limit.
  capturePhase=1;warmUntil=millis()+1100;
  setUi(kind==coco::CaptureKind::Recording?Mode::Warming:Mode::Listening,kind==coco::CaptureKind::Recording?"Mic warming. A: cancel.":"Mic warming. Keep holding A.");
}
} // namespace
std::atomic<bool> audioBusy{false};
void setUi(Mode m,const char* text) {portENTER_CRITICAL(&uiLock);ui.mode=m;strlcpy(ui.text,text?text:"",sizeof(ui.text));portEXIT_CRITICAL(&uiLock);}
Ui getUi() {
  portENTER_CRITICAL(&uiLock);Ui copy=ui;portEXIT_CRITICAL(&uiLock);
  const uint8_t phase=capturePhase.load();
  if(phase) {
    if(captureKind.load()==coco::CaptureKind::Recording) {
      copy.mode=phase==1?Mode::Warming:Mode::Recording;
      if(phase==1)strlcpy(copy.text,"Mic warming. A: cancel.",sizeof(copy.text));
      else {const unsigned seconds=recordingSeconds.load(),limit=activeSeconds.load();snprintf(copy.text,sizeof(copy.text),"%02u:%02u / %02u:%02u. A: stop + save.",seconds/60,seconds%60,limit/60,limit%60);}
    } else {copy.mode=Mode::Listening;strlcpy(copy.text,phase==1?"Mic warming. Keep holding A.":"Listening. Release A to send.",sizeof(copy.text));}
  }
  return copy;
}
String requestId(const char* prefix) {char b[70];snprintf(b,sizeof(b),"%s_%08lx%08lx%08lx",prefix,(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());return b;}
bool apiJson(const char* method,const String& path,const String& body,JsonDocument& out) {
  WiFiClientSecure client;HTTPClient http;httpSetup(http,client,path);
  http.addHeader("Content-Type","application/json");
  lastStatus=http.sendRequest(method,body);
  bool ok=lastStatus>=200 && lastStatus<300;
  // Server JSON is bounded; never log response bodies or authentication headers.
  if(ok && http.getSize()>128*1024)ok=false;
  if(ok) {BoundedBuffer buf(128*1024);int n=buf.bytes?http.writeToStream(&buf):-1;ok=n>0 && !deserializeJson(out,buf.bytes,buf.length);}
  http.end();return ok;
}
bool startApp() {
  uploads=xQueueCreate(1,sizeof(Upload));playbacks=xQueueCreate(1,sizeof(Playback));playbackResults=xQueueCreate(1,sizeof(bool));
  return uploads && playbacks && playbackResults && xTaskCreatePinnedToCore(networkTask,"coco_net",16384,nullptr,1,nullptr,1)==pdPASS;
}
void audioSelfTest() {beginCapture(coco::CaptureKind::Voice,true);}
void updateAudio(bool pressed,bool released,bool nfcButton) {
  static Playback playing{};static uint32_t playStarted=0;
  const auto state=coco::buttonCaptureState(capture!=nullptr,audioBusy.load(),selfTest,captureKind.load());
  const auto action=blueButton.update(millis(),pressed,released,state,nfcButton);
  if(action==coco::ButtonAction::StartVoice)beginCapture(coco::CaptureKind::Voice);
  if(action==coco::ButtonAction::StartRecording)beginCapture(coco::CaptureKind::Recording);
  if(action==coco::ButtonAction::StopVoice || action==coco::ButtonAction::StopRecording)stopping=true;
  if(capture) {
    if(warming) {
      if(stopping) {abortCapture(Mode::Idle,captureKind.load()==coco::CaptureKind::Recording?"Recording canceled. Nothing saved.":"Hold A while speaking");return;}
      if(int32_t(millis()-warmUntil)>=0) {
        warming=false;capturePhase=2;captureStart=millis();
        setUi(captureKind.load()==coco::CaptureKind::Recording?Mode::Recording:Mode::Listening,captureKind.load()==coco::CaptureKind::Recording?"Recording. A: stop + save.":"Listening. Release A to send.");
        if(!M5.Mic.record(reinterpret_cast<int16_t*>(capture+44),chunk,16000,false))abortCapture(Mode::Error,"Microphone capture failed");
      }
    } else if(!M5.Mic.isRecording()) {
      completed+=chunk;
      recordingSeconds=completed/coco::kSampleRate;
      if(selfTest && completed>=3*coco::kSampleRate)stopping=true;
      if(stopping || completed>=captureLimit || millis()-captureStart>=activeSeconds.load()*1000)finishCapture();
      else if(!M5.Mic.record(reinterpret_cast<int16_t*>(capture+44)+completed,chunk,16000,false))abortCapture(Mode::Error,"Microphone capture failed");
    } else if(millis()-captureStart>activeSeconds.load()*1000+2000) {
      abortCapture(Mode::Error,"Microphone timed out");
    }
  }
  if(!playing.bytes && !capture && xQueueReceive(playbacks,&playing,0)==pdTRUE) {
    coco::Wav w; bool ok=coco::parseWav(playing.bytes,playing.size,w);
    M5.Mic.end();M5.Speaker.setVolume(180);
    ok=ok && M5.Speaker.begin() && M5.Speaker.playRaw(reinterpret_cast<const int16_t*>(playing.bytes+w.offset),w.samples,w.rate,w.channels==2,1,0,true);
    playStarted=millis();if(selfTest)setUi(Mode::Speaking,"Microphone test");else showReply(Mode::Speaking);
    Serial.printf("COCO_PLAYBACK_START ok=%u rate=%u samples=%u\n",ok,w.rate,unsigned(w.samples));
    if(!ok) {M5.Speaker.end();free(playing.bytes);playing={};if(selfTest){selfTest=false;audioBusy=false;}else xQueueSend(playbackResults,&ok,0);}
  }
  if(playing.bytes && (!M5.Speaker.isPlaying() || millis()-playStarted>120000)) {
    bool ok=!M5.Speaker.isPlaying();M5.Speaker.end();free(playing.bytes);playing={};
    Serial.printf("COCO_PLAYBACK_DONE ok=%u\n",ok);
    if(ok)showReply(Mode::Idle);else setUi(Mode::Error,"Speaker timed out");
    if(selfTest) {selfTest=false;audioBusy=false;} else xQueueSend(playbackResults,&ok,0);
  }
}
