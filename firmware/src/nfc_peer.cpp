#include "nfc_peer.h"
#include "settings.h"
#include "app.h"
#include "api.h"
#include "protocol.h"
#include <M5Unified.h>
#include <M5UnitUnified.h>
#include <M5UnitUnifiedNFC.h>
#include <wiring/m5_unit_unified_wiring.hpp>
#include <atomic>
#include <ctime>

using namespace m5::nfc;
using namespace m5::nfc::a;
namespace {
m5::unit::UnitUnified units;
m5::unit::UnitNFC nfc;
NFCLayerA reader(nfc);
PICC picc;
uint8_t memory[180]{};
std::atomic<uint32_t> lastRead{0};
// Only the NFC task touches the tag, reader, RF configuration and armed peer.
std::atomic<uint8_t> armRequest{0};
std::atomic<uint32_t> activeArm{0};
uint32_t armedAt=0;
bool armed=false,readMode=false,exchanged=false;
uint8_t readerNonce[8]{};
unsigned polls=0,detections=0,selections=0,responses=0;
unsigned peakTagState=0;
constexpr uint32_t kArmMs=30000;
struct Peer {char token[coco::kMaxToken+1];char nonce[17];bool proposer;uint32_t armedAt,observedAt;};
QueueHandle_t peers=nullptr;
Peer current{};
String proposalId,confirmationId;
String pendingEncounter;
uint32_t retryAt=0;
unsigned attempts=0;
time_t armedUnix=0;
bool confirmed=false;

class CocoTag : public EmulationLayerA {
 public:
  using EmulationLayerA::EmulationLayerA;
  State receive_callback(const uint8_t* rx,uint32_t length) override {
    if(!rx || !length)return State::Idle;
    if(rx[0]==0xC0) {
      // Private badge protocol v1: opcode, version, token length, token, 8-byte nonce.
      // Public NFC tokens carry no API authority. Only an armed, matching API offer can confirm.
      char peer[coco::kMaxToken+1]{};
      if(!armed || readMode || !coco::liveWindow(millis(),armedAt,kArmMs) ||
         !coco::peerFrame(rx,length,0xC0,peer) || settings.nfcToken==peer)return State::Idle;
      static char lockedPeer[coco::kMaxToken+1]{};
      static uint32_t lockedArm=0;
      static uint8_t lockedNonce[8]{};
      if(exchanged && (lockedArm!=armedAt || strcmp(lockedPeer,peer) || memcmp(lockedNonce,rx+3+rx[2],8)))return State::Idle;
      uint8_t response[3+coco::kMaxToken+8]{};
      response[0]=0xC1;response[1]=1;response[2]=settings.nfcToken.length();
      memcpy(response+3,settings.nfcToken.c_str(),response[2]);
      memcpy(response+3+response[2],rx+3+rx[2],8);
      if(!transmit(response,3+response[2]+8,2))return State::Idle;
      if(!exchanged) {
        observedPeer(peer,false,armedAt,rx+3+rx[2]);
        strlcpy(lockedPeer,peer,sizeof(lockedPeer));memcpy(lockedNonce,rx+3+rx[2],8);lockedArm=armedAt;exchanged=true;
        lastRead=millis();Serial.println("COCO_NFC_EXCHANGE role=emulator");
      }
      return State::Active;
    }
    // Keep the established NTAG213 read-only behavior and reader compatibility.
    if(rx[0]==0xA2 || rx[0]==0xA0)return State::Idle;
    if(rx[0]==0x39 && length==2) {const uint8_t count[]={0,0,0};return transmit(count,3,2)?State::Active:State::Idle;}
    if(rx[0]==0x30 && length!=2)return State::Idle;
    const State result=EmulationLayerA::receive_callback(rx,length);
    if(result==State::Active && ((rx[0]==0x30 && length==2 && rx[1]>=4) || (rx[0]==0x3A && length==3 && rx[2]>=4)))lastRead=millis();
    return result;
  }
};
CocoTag tag(nfc);
bool emulate() {
  reader.deactivate();nfc.disableField();
  auto cfg=nfc.config();cfg.emulation=true;nfc.config(cfg);
  if(!nfc.begin() || !tag.begin(picc,memory,sizeof(memory)))return false;
  tag.setExpiredTime(3000);return true;
}
void reportRf() {
  uint8_t operation=0,mode=0,tuning1=0,tuning2=0;
  const bool ok=nfc.readOperationControl(operation) && nfc.readModeDefinition(mode) &&
    nfc.readAntennaTuningControl1(tuning1) && nfc.readAntennaTuningControl2(tuning2);
  Serial.printf("COCO_NFC_RF read_ok=%u operation=%02x mode=%02x tuning=%02x,%02x\n",ok,operation,mode,tuning1,tuning2);
}
void scan() {
  ++polls;PICC found;
  if(!reader.wakeup(found.atqa))return;
  ++detections;
  if(!reader.select(found))return;
  ++selections;
  uint8_t tx[3+coco::kMaxToken+8]{0xC0,1,uint8_t(settings.nfcToken.length())};
  memcpy(tx+3,settings.nfcToken.c_str(),tx[2]);
  memcpy(tx+3+tx[2],readerNonce,8); // Retransmissions retain this arm's nonce.
  uint8_t rx[3+coco::kMaxToken+8+2]{};uint16_t len=sizeof(rx);
  char token[coco::kMaxToken+1]{};
  const bool replied=reader.transceive(rx,len,tx,3+tx[2]+8,40);
  if(replied)++responses;
  const bool valid=replied && coco::peerRfFrame(rx,len,0xC1,token,tx+3+tx[2]);
  if(replied && responses==1)Serial.printf("COCO_NFC_REPLY bytes=%u valid=%u\n",len,valid);
  if(valid && settings.nfcToken!=token) {
    observedPeer(token,true,armedAt,tx+3+tx[2]);exchanged=true;lastRead=millis();
    Serial.println("COCO_NFC_EXCHANGE role=reader");
  }
  reader.deactivate();
  if(exchanged)nfc.disableField();
}
void task(void*) {
  uint32_t lastYield=millis();
  for(;;) {
    const uint8_t request=armRequest.exchange(0);
    if(request) {
      tag.end();nfc.disableField();armed=false;exchanged=false;readMode=request==2;
      polls=detections=selections=responses=peakTagState=0;
      for(auto& byte:readerNonce)byte=esp_random();
      auto cfg=nfc.config();cfg.emulation=!readMode;nfc.config(cfg);
      // Emulation changes antenna tuning and timers that configureNFCMode does
      // not restore. Reinitialize the chip for every role transition.
      bool ok=readMode?nfc.begin():emulate();
      Serial.printf("COCO_NFC_ARM role=%s ok=%u\n",readMode?"reader":"emulator",ok);
      reportRf();
      if(ok) {armedAt=millis();activeArm=armedAt;armed=true;setUi(Mode::Meeting,readMode?"Reader ready. Tap the armed badge.":"Tap armed. Partner holds B to read.");}
      else setUi(Mode::Error,"NFC mode change failed");
    }
    if(armed && !coco::liveWindow(millis(),armedAt,kArmMs)) {
      Serial.printf("COCO_NFC_WINDOW reader=%u polls=%u detected=%u selected=%u responses=%u exchanged=%u state=%u peak_state=%u\n",readMode,polls,detections,selections,responses,exchanged,unsigned(tag.state()),peakTagState);
      reportRf();
      armed=false;activeArm=0;
      if(readMode) {readMode=false;if(!emulate())setUi(Mode::Error,"NFC restart failed");}
      if(!exchanged)setUi(Mode::Idle,"Tap timed out. Press B to try again.");
    }
    units.update();
    if(readMode && armed && !exchanged)scan();
    else if(!readMode) {tag.update();if(armed && unsigned(tag.state())>peakTagState)peakTagState=unsigned(tag.state());}
    // Original polling cadence: dedicated core, no display work, one tick every 500 ms.
    if(millis()-lastYield>500) {vTaskDelay(1);lastYield=millis();}
  }
}
time_t parseTime(const char* text) {
  if(!text)return 0;
  tm t{};if(!strptime(text,"%Y-%m-%dT%H:%M:%S",&t))return 0;
  return mktime(&t); // configTime uses UTC throughout the firmware.
}
}
uint32_t lastNfcRead(){return lastRead.load();}
void observedPeer(const char* token,bool proposer,uint32_t when,const uint8_t* nonce) {
  Peer p{};strlcpy(p.token,token,sizeof(p.token));p.proposer=proposer;p.armedAt=when;p.observedAt=millis();
  for(unsigned i=0;i<8;++i)snprintf(p.nonce+i*2,3,"%02x",nonce[i]);
  if(peers)xQueueOverwrite(peers,&p);
}
bool nfcArmed() {const uint32_t at=activeArm.load();return at && coco::liveWindow(millis(),at,kArmMs);}
void armNfc(bool read) {if(audioBusy) {Serial.println("COCO_NFC_ARM busy_audio");return;}activeArm=0;armRequest=read?2:1;}
bool startNfc() {
  // NTAG213's 144-byte NDEF area fits a 96-byte token and external record metadata.
  if(!coco::safeId(settings.nfcToken.c_str(),16,coco::kMaxToken))return false;
  peers=xQueueCreate(1,sizeof(Peer));if(!peers)return false;
  auto config=nfc.config();config.emulation=true;config.mode=NFC::A;nfc.config(config);
  M5.Power.setExtOutput(true);delay(100);
  if(!m5::unit::wiring::addI2C(units,nfc,400000,m5::unit::wiring::NessoPort::PortA)) {Serial.println("COCO_NFC_INIT wiring_failed");return false;}
  bool ready=false;
  for(unsigned attempt=0;attempt<3 && !ready;++attempt) {
    if(attempt) {M5.Power.setExtOutput(false);delay(150);M5.Power.setExtOutput(true);delay(300);}
    ready=units.begin();Serial.printf("COCO_NFC_INIT attempt=%u ready=%u\n",attempt+1,ready);
  }
  if(!ready)return false;
  uint64_t mac=ESP.getEfuseMac();uint8_t uid[7]={0x04};
  for(unsigned i=1;i<7;++i)uid[i]=(mac>>((i-1)*8))&255;
  memcpy(memory,uid,3);memory[3]=0x88^uid[0]^uid[1]^uid[2];memcpy(memory+4,uid+3,4);
  memory[8]=uid[3]^uid[4]^uid[5]^uid[6];memory[9]=0x48;
  memory[12]=0xE1;memory[13]=0x10;memory[14]=0x12;memory[15]=0x0F;
  // External-type NDEF record. No URL and no phone form.
  constexpr char type[]="coco:badge";
  size_t n=settings.nfcToken.length();
  memory[16]=0x03;memory[17]=3+sizeof(type)-1+n;memory[18]=0xD4;memory[19]=sizeof(type)-1;memory[20]=n;
  memcpy(memory+21,type,sizeof(type)-1);memcpy(memory+21+sizeof(type)-1,settings.nfcToken.c_str(),n);
  memory[21+sizeof(type)-1+n]=0xFE;
  memory[164]=0x04;memory[167]=0xFF;memset(memory+172,0xFF,4);
  if(!picc.emulate(Type::NTAG_213,uid,sizeof(uid)) || !tag.begin(picc,memory,sizeof(memory))) {Serial.println("COCO_NFC_INIT tag_failed");return false;}
  tag.setExpiredTime(3000);
  return xTaskCreatePinnedToCore(task,"nfc",8192,nullptr,2,nullptr,0)==pdPASS;
}
void updateEncounters() {
  Peer p{};
  if(peers && xQueueReceive(peers,&p,0)==pdTRUE) {
    current=p;proposalId=requestId("tap");confirmationId=requestId("confirm");
    armedUnix=time(nullptr)-uint32_t(millis()-p.armedAt)/1000;
    pendingEncounter="";attempts=0;retryAt=0;confirmed=false;
    setUi(Mode::Meeting,"Badge read. Waiting for confirmation.");
  }
  if(!current.token[0] || current.armedAt!=activeArm.load() || !current.proposer || pendingEncounter.length() || attempts>=3 ||
     !coco::liveWindow(millis(),current.armedAt,kArmMs) || int32_t(millis()-retryAt)<0)return;
  JsonDocument body,out;body["requestId"]=proposalId;body["peerToken"]=current.token;
  body["context"]=String("Badge tap at Enter the SI Era; nonce=")+current.nonce;String json;serializeJson(body,json);
  ++attempts;retryAt=millis()+(1000U<<attempts);
  if(apiJson("POST","/v1/encounters",json,out)) {
    pendingEncounter=out["encounterId"].as<String>();Serial.printf("COCO_ENCOUNTER_PROPOSED id=%s\n",pendingEncounter.c_str());
  } else setUi(Mode::Error,"Tap proposal failed. Retrying.");
}
bool handleEncounter(JsonVariantConst command) {
  auto p=command["payload"];
  const String token=p["fromNfcToken"]|"",id=p["encounterId"]|"";
  // Offers alone never prove a tap. Require the observed public token, a live arm,
  // and an offer created during this arm. Accept only one encounter per exchange.
  if(!coco::safeId(id.c_str()) || !coco::matchingTapContext(current.nonce,p["context"]|"") ||
     !coco::canConfirmPeer(millis(),current.armedAt,activeArm.load(),current.proposer,current.token,token.c_str(),
       armedUnix,parseTime(command["createdAt"]),parseTime(p["expiresAt"]),time(nullptr)) ||
     (pendingEncounter.length() && pendingEncounter!=id))return false;
  pendingEncounter=id;
  if(confirmed)return true;
  JsonDocument body,out;body["requestId"]=confirmationId;String json;serializeJson(body,json);
  if(!apiJson("POST","/v1/encounters/"+id+"/confirm",json,out) || out["status"]!="confirmed")return false;
  confirmed=true;setUi(Mode::Meeting,"Connection saved");Serial.printf("COCO_ENCOUNTER_CONFIRMED id=%s\n",id.c_str());return true;
}
