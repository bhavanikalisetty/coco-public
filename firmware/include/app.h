#pragma once
#include <Arduino.h>
#include <atomic>
#include <ArduinoJson.h>
enum class Mode : uint8_t { Idle, Listening, Uploading, Thinking, Speaking, Coffee, Lunch, Meeting, Recording, Saving, Offline, Error, Warming };
struct Ui { Mode mode; char text[241]; };
void setUi(Mode mode,const char* text);
Ui getUi();
extern std::atomic<bool> audioBusy;
bool startApp();
void updateAudio(bool pressed,bool released,bool nfcButton=false);
void audioSelfTest();
// Called by the NFC task after a locally armed exchange. No HTTP on the NFC core.
void observedPeer(const char* token,bool proposer,uint32_t armedAt,const uint8_t* nonce);
bool handleEncounter(JsonVariantConst command);
void updateEncounters();
