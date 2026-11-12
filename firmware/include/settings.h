#pragma once
#include <Arduino.h>
struct Settings { String ssid,password,token,nfcToken,deviceId; };
extern Settings settings;
bool loadSettings();
void serialProvisioning();
