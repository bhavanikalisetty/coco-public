#include "settings.h"
#include "protocol.h"
#include "provision_store.h"
#include "app.h"
#include "nfc_peer.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_mac.h>
Settings settings;
namespace {
bool decode(const String& encoded,Settings& out) {
  JsonDocument d;
  if(deserializeJson(d,encoded) || d["version"].as<int>()!=1 || !d["ssid"].is<String>() || !d["password"].is<String>() ||
     !d["ssid"].as<String>().length() || d["ssid"].as<String>().length()>32 || d["password"].as<String>().length()>63 ||
     !coco::safeId(d["token"],32,200) || !coco::safeId(d["nfcToken"],16,coco::kMaxToken) || !coco::safeId(d["deviceId"]))return false;
  out={d["ssid"].as<String>(),d["password"].as<String>(),d["token"].as<String>(),d["nfcToken"].as<String>(),d["deviceId"].as<String>()};
  return true;
}
}
bool loadSettings() {
  Preferences p;if(!p.begin("coco",true))return false;
  const uint8_t active=p.getUChar("active",255);
  bool ok=false;
  if(active<=1) {
    ok=decode(p.getString(active?"cfg1":"cfg0"),settings);
    if(!ok)ok=decode(p.getString(active?"cfg0":"cfg1"),settings);
  } else {
    // Read-only migration from the initial prototype. New provisioning never
    // edits these keys, so an interrupted first slot write retains all five.
    JsonDocument d;d["version"]=1;d["ssid"]=p.getString("ssid");d["password"]=p.getString("password");
    d["token"]=p.getString("token");d["nfcToken"]=p.getString("nfc");d["deviceId"]=p.getString("device");
    String encoded;serializeJson(d,encoded);ok=decode(encoded,settings);
  }
  p.end();return ok;
}
void serialProvisioning() {
  static String line;
  while(Serial.available()) {
    char c=Serial.read();
    if(c=='\n') {
      if(line=="identity") {
        uint8_t mac[6];esp_read_mac(mac,ESP_MAC_WIFI_STA);
        Serial.printf("COCO_IDENTITY %02x:%02x:%02x:%02x:%02x:%02x device=%s\n",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],settings.deviceId.c_str());
      } else if(line=="nfc_reader")armNfc(true);
      else if(line=="nfc_emulator")armNfc(false);
      else if(line=="test_audio" && settings.token.length())audioSelfTest();
      else if(line.startsWith("provision ")) {
        JsonDocument d;String encoded;Settings candidate;
        bool ok=!deserializeJson(d,line.substring(10));
        d["version"]=1;serializeJson(d,encoded);ok=ok && decode(encoded,candidate);
        if(!ok)Serial.println("COCO_PROVISION_INVALID");
        else {
          Preferences p;ok=p.begin("coco",false);
          if(ok) {
            ok=coco::commitConfig(p,encoded,[](const String& value){Settings s;return decode(value,s);});p.end();
          }
          Serial.println(ok?"COCO_PROVISIONED_RESTART":"COCO_PROVISION_FAILED");
          if(ok){delay(100);ESP.restart();}
        }
      }
      line="";
    } else if(c!='\r') {
      if(line.length()<1024)line+=c;else line="";
    }
  }
}
