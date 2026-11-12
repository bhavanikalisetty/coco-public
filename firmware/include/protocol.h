#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cstdio>

namespace coco {
constexpr uint32_t kSampleRate = 16000;
constexpr size_t kMaxSamples = kSampleRate * 15;
constexpr size_t kWavHeader = 44;
constexpr size_t kMaxReplyBytes = 3 * 1024 * 1024;
constexpr size_t kMaxToken = 96;
inline uint16_t u16(const uint8_t* p) { return p[0] | (uint16_t(p[1]) << 8); }
inline uint32_t u32(const uint8_t* p) { return u16(p) | (uint32_t(u16(p+2)) << 16); }
inline void put16(uint8_t* p, uint16_t v) { p[0]=v; p[1]=v>>8; }
inline void put32(uint8_t* p, uint32_t v) { put16(p,v); put16(p+2,v>>16); }
inline void wavHeader(uint8_t* p, size_t samples) {
  memcpy(p,"RIFF",4); put32(p+4,36+samples*2); memcpy(p+8,"WAVEfmt ",8);
  put32(p+16,16); put16(p+20,1); put16(p+22,1); put32(p+24,kSampleRate);
  put32(p+28,kSampleRate*2); put16(p+32,2); put16(p+34,16);
  memcpy(p+36,"data",4); put32(p+40,samples*2);
}
struct Wav { size_t offset=0, samples=0; uint32_t rate=0; uint16_t channels=0; };
inline bool parseWav(const uint8_t* p, size_t size, Wav& out) {
  out={};
  if (!p || size<44 || memcmp(p,"RIFF",4) || memcmp(p+8,"WAVE",4)) return false;
  const uint32_t riff=u32(p+4);
  const bool streaming=riff==0xffffffffU;
  if (!streaming && (riff<36 || riff>size-8)) return false;
  // OpenAI's WAV response uses unknown-length markers. Only accept the terminal
  // data marker in a completely downloaded, bounded HTTP body.
  const size_t end=streaming?size:8+riff; bool fmt=false, data=false;
  for(size_t at=12; at+8<=end;) {
    size_t n=u32(p+at+4), start=at+8;
    if(streaming && n==0xffffffffU && !memcmp(p+at,"data",4))n=end-start;
    if (n>end-start) return false;
    if (!memcmp(p+at,"fmt ",4)) {
      if(fmt || n<16 || u16(p+start)!=1 || u16(p+start+14)!=16) return false;
      out.channels=u16(p+start+2); out.rate=u32(p+start+4);
      if((out.channels!=1 && out.channels!=2) || out.rate<8000 || out.rate>48000 ||
          u16(p+start+12)!=out.channels*2 || u32(p+start+8)!=out.rate*out.channels*2) return false;
      fmt=true;
    } else if(!memcmp(p+at,"data",4)) {
      if(data || !n || (start&1)) return false;
      out.offset=start; out.samples=n/2; data=true;
      if(n&1) return false;
    }
    at=start+n+(n&1);
    if(at>end) return false;
  }
  return fmt && data && out.samples%out.channels==0;
}
inline bool safeId(const char* value, size_t min=1, size_t max=100) {
  if(!value) return false;
  size_t n=0;
  for(;value[n];++n) {
    const char c=value[n];
    if(n>=max || !((c>='a'&&c<='z') || (c>='A'&&c<='Z') || (c>='0'&&c<='9') || c=='_' || c=='-')) return false;
  }
  return n>=min;
}
// Validate NFC framing before copying a public token. Reject embedded NULs and
// unexpected trailers so the declared identity and compared identity are equal.
inline bool peerFrame(const uint8_t* p,size_t n,uint8_t opcode,char* token,const uint8_t* nonce=nullptr) {
  if(!p || !token || n<27 || p[0]!=opcode || p[1]!=1 || p[2]<16 || p[2]>kMaxToken || n!=size_t(3+p[2]+8))return false;
  if(nonce && memcmp(p+3+p[2],nonce,8))return false;
  memcpy(token,p+3,p[2]);token[p[2]]=0;
  return strlen(token)==p[2] && safeId(token,16,kMaxToken);
}
inline uint16_t crcA(const uint8_t* p,size_t n) {
  uint16_t crc=0x6363;
  while(n--) {
    crc^=*p++;
    for(unsigned bit=0;bit<8;++bit)crc=(crc>>1)^((crc&1)?0x8408:0);
  }
  return crc;
}
// The reader's raw ST25R3916 FIFO includes CRC-A. The emulator adapter already
// verifies and removes it before invoking receive_callback.
inline bool peerRfFrame(const uint8_t* p,size_t n,uint8_t opcode,char* token,const uint8_t* nonce=nullptr) {
  return p && n>=2 && n<=3+kMaxToken+8+2 && crcA(p,n-2)==u16(p+n-2) &&
    peerFrame(p,n-2,opcode,token,nonce);
}
inline bool liveWindow(uint32_t now, uint32_t since, uint32_t window) { return uint32_t(now-since)<window; }
inline bool matchingTapContext(const char* nonce,const char* context) {
  if(!safeId(nonce,16,16) || !context)return false;
  char expected[80];snprintf(expected,sizeof(expected),"Badge tap at Enter the SI Era; nonce=%s",nonce);
  return !strcmp(expected,context);
}
inline bool canConfirmPeer(uint32_t now,uint32_t arm,uint32_t activeArm,bool proposer,
    const char* observed,const char* offered,int64_t armedUnix,int64_t created,int64_t expires,int64_t nowUnix) {
  return arm && arm==activeArm && !proposer && liveWindow(now,arm,30000) &&
    safeId(observed,16,kMaxToken) && safeId(offered,16,kMaxToken) && !strcmp(observed,offered) &&
    armedUnix>0 && created>=armedUnix && expires>nowUnix;
}
} // namespace coco
