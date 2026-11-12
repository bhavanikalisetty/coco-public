#include <Arduino.h>
#include <M5Unified.h>
#include <M5UnitUnified.h>
#include <M5UnitUnifiedNFC.h>
#include <wiring/m5_unit_unified_wiring.hpp>
#include <algorithm>
#include <atomic>
#include "badge_assets.h"

#include "app.h"
#include "nfc_peer.h"
#include "settings.h"

M5Canvas canvas(&M5.Display);
bool provisioned=false,nfcReady=false;
constexpr uint32_t BG = 0x060910;
constexpr uint32_t THEMES[][3] = {
  {0xA8EFFF, 0xF0FCFF, 0x173849},
  {0xADFFDB, 0xF1FFF8, 0x193D30},
  {0xFFE4A3, 0xFFFCF1, 0x41351F},
};
uint16_t rgb565(uint32_t c) {
  return ((c >> 8) & 0xF800) | ((c >> 5) & 0x07E0) | ((c >> 3) & 0x001F);
}
void rect(int x, int y, int w, int h, uint32_t color) {
  canvas.fillRect(x, y, w, h, rgb565(color));
}
uint32_t mix(uint32_t a, uint32_t b, int amount) {
  uint32_t result = 0;
  for (int shift : {0, 8, 16}) {
    result |= (((((a >> shift) & 255) * (255-amount)) +
                 (((b >> shift) & 255) * amount)) / 255) << shift;
  }
  return result;
}

void drawBadge(uint32_t frame, int theme) {
  const auto primary = THEMES[theme][0];
  const auto accent = THEMES[theme][1];
  const auto shadow = THEMES[theme][2];
  rect(0, 0, 240, 135, BG);
  for (int i=0; i<22; ++i) {
    const int x=(i*43+11)%232+4, y=(i*29+7)%127+4;
    if ((70<x && x<174 && y<74) || (20<x && x<220 && 74<y && y<112)) continue;
    rect(x,y,2,2,mix(BG,accent,(frame+i*17)%90<7 ? 105 : 24));
  }
  const int bob[] = {0,1,2,1};
  const int dogY=4+bob[(frame/10)%4], dogX=(240-DOG_WIDTH*2)/2;
  for (const auto& run : DOG_RUNS) rect(dogX+run.x*2,dogY+run.y*2,run.width*2,2,run.color);
  canvas.setTextDatum(top_center);
  canvas.setTextColor(rgb565(primary));
  canvas.setFont(&fonts::Font2);
  canvas.drawString("Coco",120,73);
  const Ui ui=getUi();
  canvas.setFont(&fonts::Font0);
  canvas.setTextColor(rgb565(accent));
  // Scroll longer server text in one line; the full reply remains in the portal.
  String text=ui.text;
  const int visible=37;
  if(text.length()>visible) {
    unsigned offset=(frame/5)%(text.length()+12);
    text=text+"            "+text;
    text=text.substring(offset,offset+visible);
  }
  canvas.drawString(text,120,99);
  canvas.setTextColor(rgb565(primary));
  static const char* modes[]={"Ready","Listening","Uploading","Thinking","Speaking (AI voice)","Coffee","Lunch","Meeting","Recording","Saving","Offline","Error","Mic warming"};
  canvas.drawString(modes[unsigned(ui.mode)],120,114);
  if(ui.mode==Mode::Recording)rect(10,8,7,7,0xFF5555);
  canvas.setTextColor(rgb565(mix(BG,accent,120)));
  canvas.drawString("Enter the SI Era",120,126);
  const uint32_t readAt=lastNfcRead();
  if(readAt && millis()-readAt<2000)rect(226,8,5,5,0xADFFDB);
} 

void setup() {
  auto config=M5.config();
  config.internal_spk=true;
  config.internal_mic=true;
  M5.begin(config);
  M5.Speaker.end();
  M5.Mic.end();
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(255);
  canvas.setColorDepth(16);
  if (!canvas.createSprite(240,135)) {
    M5.Display.fillScreen(TFT_BLACK);
    M5.Display.print("Display allocation failed");
    return;
  }
  drawBadge(0,0); canvas.pushSprite(0,0);
  provisioned=loadSettings();
  if(provisioned) {
    nfcReady=startNfc();
    if(!nfcReady)M5.Power.setExtOutput(false);
    if(!startApp()) {provisioned=false;setUi(Mode::Error,"Task allocation failed");}
  }
  Serial.printf("COCO_BOOT provisioned=%u nfc=%u psram=%u\n",provisioned,nfcReady,ESP.getPsramSize());
  Serial.println("COCO_FIRST_FRAME_OK");
}

void loop() {
  static uint32_t frame=0,lastFrame=0,lastStatus=0,buttonBAt=0;
  M5.update();serialProvisioning();
  const uint32_t now=millis();
  if(provisioned) {
    updateAudio(M5.BtnA.wasPressed(),M5.BtnA.wasReleased(),M5.BtnB.isPressed() || M5.BtnB.wasReleased());
    if(M5.BtnB.wasPressed())buttonBAt=now;
    if(M5.BtnB.wasReleased() && nfcReady && !audioBusy)armNfc(now-buttonBAt>=700);
  }
  if(now-lastFrame>=50) {drawBadge(frame,0);canvas.pushSprite(0,0);frame=(frame+1)%12600;lastFrame=now;}
  if(now-lastStatus>=10000) {
    Serial.printf("COCO_HEALTH nfc=%u mode=%u heap=%u psram_free=%u\n",nfcReady,unsigned(getUi().mode),ESP.getFreeHeap(),ESP.getFreePsram());
    lastStatus=now;
  }
  delay(1);
}
