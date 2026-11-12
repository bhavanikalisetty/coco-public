#include "provision_store.h"
#include <cassert>
#include <map>
#include <string>
struct Store {
  std::map<std::string,std::string> slots{{"cfg0","complete-old"}};
  uint8_t active=0;int fail=0;
  uint8_t getUChar(const char*,uint8_t){return active;}
  size_t putString(const char* key,const std::string& value){if(fail==1){slots[key]="partial";return 7;}slots[key]=value;return value.size();}
  std::string getString(const char* key){return fail==2?"corrupt":slots[key];}
  size_t putUChar(const char*,uint8_t value){if(fail==3)return 0;active=value;return 1;}
};
int main(){
  auto valid=[](const std::string& s){return s=="complete-old" || s=="complete-new";};
  for(int failure=1;failure<=3;++failure){Store s;s.fail=failure;assert(!coco::commitConfig(s,std::string("complete-new"),valid));assert(s.active==0 && s.slots["cfg0"]=="complete-old");}
  Store s;assert(coco::commitConfig(s,std::string("complete-new"),valid));assert(s.active==1 && s.slots["cfg0"]=="complete-old" && s.slots["cfg1"]=="complete-new");
  assert(!coco::commitConfig(s,std::string("incomplete"),valid));assert(s.active==1);
}
