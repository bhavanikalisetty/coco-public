#include "protocol.h"
#include <cassert>
#include <vector>
#include <fstream>
#include <iterator>
#include <iostream>
int main(int argc,char** argv) {
  using namespace coco;
  if(argc==2) {
    std::ifstream file(argv[1],std::ios::binary);
    std::vector<uint8_t> actual((std::istreambuf_iterator<char>(file)),{});Wav parsed;
    assert(parseWav(actual.data(),actual.size(),parsed));
    std::cout<<"Actual server WAV: rate="<<parsed.rate<<" channels="<<parsed.channels<<" samples="<<parsed.samples<<"\n";
  }
  std::vector<uint8_t> b(kWavHeader+kMaxSamples*2);
  wavHeader(b.data(),kMaxSamples); Wav w;
  assert(b.size()==480044 && parseWav(b.data(),b.size(),w));
  assert(w.samples==240000 && w.rate==16000 && w.offset==44);
  assert(!parseWav(b.data(),b.size()-1,w));
  auto bad=b; put32(bad.data()+40,0xffffffff); assert(!parseWav(bad.data(),bad.size(),w));
  bad=b; put16(bad.data()+34,24); assert(!parseWav(bad.data(),bad.size(),w));
  bad=b; put16(bad.data()+22,2); assert(!parseWav(bad.data(),bad.size(),w));
  bad=b; put32(bad.data()+24,96000); assert(!parseWav(bad.data(),bad.size(),w));
  // Valid WAV with an extra padded chunk before data.
  bad=b; bad.insert(bad.begin()+36,{'J','U','N','K',1,0,0,0,42,0});
  put32(bad.data()+4,bad.size()-8); assert(parseWav(bad.data(),bad.size(),w) && w.offset==54);
  bad=b; put32(bad.data()+4,0xffffffffU);put32(bad.data()+40,0xffffffffU);
  assert(parseWav(bad.data(),bad.size(),w) && w.samples==240000);
  assert(!parseWav(bad.data(),bad.size()-1,w));
  bad=b;put32(bad.data()+40,0xffffffffU);assert(!parseWav(bad.data(),bad.size(),w));
  assert(safeId("reply_ab-12")); assert(!safeId("../../audio")); assert(!safeId("a?b"));
  uint8_t packet[43]={0xC1,1,32};
  const char* peer="0123456789abcdef0123456789abcdef";
  memcpy(packet+3,peer,32);uint8_t nonce[8]={1,2,3,4,5,6,7,8};memcpy(packet+35,nonce,8);
  char decoded[kMaxToken+1]{};
  assert(peerFrame(packet,sizeof(packet),0xC1,decoded,nonce) && !strcmp(decoded,peer));
  packet[35]^=1;assert(!peerFrame(packet,sizeof(packet),0xC1,decoded,nonce));packet[35]^=1;
  packet[20]=0;assert(!peerFrame(packet,sizeof(packet),0xC1,decoded));packet[20]=peer[17];
  assert(!peerFrame(packet,sizeof(packet)-1,0xC1,decoded));
  assert(!peerFrame(packet,sizeof(packet),0xC0,decoded));
  const uint8_t halt[]={0x50,0x00};
  assert(crcA(halt,sizeof(halt))==0xcd57);
  assert(crcA(reinterpret_cast<const uint8_t*>("123456789"),9)==0xbf05);
  std::vector<uint8_t> rf(packet,packet+sizeof(packet));rf.resize(rf.size()+2);
  put16(rf.data()+rf.size()-2,crcA(rf.data(),rf.size()-2));
  assert(peerRfFrame(rf.data(),rf.size(),0xC1,decoded,nonce));
  assert(!peerFrame(rf.data(),rf.size(),0xC1,decoded,nonce));
  rf[10]^=1;assert(!peerRfFrame(rf.data(),rf.size(),0xC1,decoded,nonce));rf[10]^=1;
  rf.back()^=1;assert(!peerRfFrame(rf.data(),rf.size(),0xC1,decoded,nonce));rf.back()^=1;
  assert(!peerRfFrame(rf.data(),rf.size()-1,0xC1,decoded,nonce));
  assert(!peerRfFrame(packet,sizeof(packet),0xC1,decoded,nonce));
  assert(!peerRfFrame(nullptr,0,0xC1,decoded,nonce));
  std::vector<uint8_t> maxRf(3+kMaxToken+8+2,'a');maxRf[0]=0xC1;maxRf[1]=1;maxRf[2]=kMaxToken;
  memcpy(maxRf.data()+3+kMaxToken,nonce,8);put16(maxRf.data()+maxRf.size()-2,crcA(maxRf.data(),maxRf.size()-2));
  assert(peerRfFrame(maxRf.data(),maxRf.size(),0xC1,decoded,nonce) && strlen(decoded)==kMaxToken);
  assert(matchingTapContext("0123456789abcdef","Badge tap at Enter the SI Era; nonce=0123456789abcdef"));
  assert(!matchingTapContext("0123456789abcdef","Demo verification"));
  assert(!matchingTapContext("0123456789abcdef","Badge tap at Enter the SI Era; nonce=fedcba9876543210"));
  assert(!matchingTapContext("","Badge tap at Enter the SI Era; nonce="));
  assert(canConfirmPeer(200,100,100,false,peer,peer,1000,1001,1100,1002));
  assert(!canConfirmPeer(200,100,0,false,peer,peer,1000,1001,1100,1002));
  assert(!canConfirmPeer(30200,100,100,false,peer,peer,1000,1001,1100,1002));
  assert(!canConfirmPeer(200,100,100,true,peer,peer,1000,1001,1100,1002));
  assert(!canConfirmPeer(200,100,100,false,peer,"fedcba9876543210fedcba9876543210",1000,1001,1100,1002));
  assert(!canConfirmPeer(200,100,100,false,peer,peer,1000,999,1100,1002));
  assert(!canConfirmPeer(200,100,100,false,peer,peer,1000,1001,1002,1002));
  assert(liveWindow(9,0xfffffff0U,30)); assert(!liveWindow(20,0xfffffff0U,30));
}
