#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
String requestId(const char* prefix);
bool apiJson(const char* method,const String& path,const String& body,JsonDocument& out);
