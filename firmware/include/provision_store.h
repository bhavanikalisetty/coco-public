#pragma once
#include <cstdint>
namespace coco {
// One active marker selects an entire verified blob. The old slot is untouched.
// A failed write/readback never changes the active identity.
template<class Store,class Text,class Validate>
bool commitConfig(Store& store,const Text& encoded,Validate valid) {
  if(!valid(encoded))return false;
  const uint8_t active=store.getUChar("active",255);
  const uint8_t next=active==0?1:0;
  const char* key=next?"cfg1":"cfg0";
  if(store.putString(key,encoded)!=encoded.length())return false;
  const auto saved=store.getString(key);
  if(saved!=encoded || !valid(saved))return false;
  return store.putUChar("active",next)==1;
}
}
