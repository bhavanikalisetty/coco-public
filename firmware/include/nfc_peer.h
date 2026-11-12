#pragma once
#include <cstdint>
bool startNfc();
void armNfc(bool reader);
uint32_t lastNfcRead();
bool nfcArmed();
