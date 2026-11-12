#pragma once
#include <cstdint>
#include "protocol.h"

namespace coco {
enum class CaptureKind { Voice, Recording };
constexpr uint32_t kMaxRecordingSeconds=60;
inline uint32_t captureSeconds(CaptureKind kind,uint32_t serverLimit=kMaxRecordingSeconds) {
  return kind==CaptureKind::Voice?15:(serverLimit<kMaxRecordingSeconds?serverLimit:kMaxRecordingSeconds);
}
inline size_t captureSamples(CaptureKind kind,uint32_t serverLimit=kMaxRecordingSeconds) {
  return size_t(captureSeconds(kind,serverLimit))*kSampleRate;
}
inline const char* capturePath(CaptureKind kind) {
  return kind==CaptureKind::Recording?"/v1/recordings":"/v1/voice";
}
inline const char* capturePrefix(CaptureKind kind) {
  return kind==CaptureKind::Recording?"recording":"voice";
}

enum class CaptureState { Idle, Voice, Recording, Busy };
inline CaptureState buttonCaptureState(bool hasCapture,bool busy,bool selfTest,CaptureKind kind) {
  // Resource ownership is authoritative. A stale diagnostic flag must never
  // disable the button after a failed microphone test has released its buffers.
  if(!hasCapture)return busy?CaptureState::Busy:CaptureState::Idle;
  if(selfTest)return CaptureState::Busy;
  return kind==CaptureKind::Recording?CaptureState::Recording:CaptureState::Voice;
}
enum class ButtonAction { None, StartVoice, StopVoice, StartRecording, StopRecording };
// Only two short presses start a recording. A sustained press remains chat,
// including when it follows a short tap. Millisecond subtraction handles wrap.
class BlueButton {
 public:
  static constexpr uint32_t holdMs=300,tapGapMs=350;
  ButtonAction update(uint32_t now,bool pressed,bool released,CaptureState state,bool nfcButton=false) {
    if(state==CaptureState::Recording) {reset();return pressed?ButtonAction::StopRecording:ButtonAction::None;}
    if(state==CaptureState::Voice) {reset();return released?ButtonAction::StopVoice:ButtonAction::None;}
    if(state==CaptureState::Busy || nfcButton) {reset();return ButtonAction::None;}
    if(pending && uint32_t(now-lastTap)>tapGapMs)pending=false;
    if(pressed) {down=true;pressedAt=now;second=pending;pending=false;}
    if(down && !released && uint32_t(now-pressedAt)>=holdMs) {
      reset();return ButtonAction::StartVoice;
    }
    if(released && down) {
      down=false;
      if(uint32_t(now-pressedAt)>=holdMs) {reset();return ButtonAction::None;}
      if(second) {reset();return ButtonAction::StartRecording;}
      pending=true;lastTap=now;
    }
    return ButtonAction::None;
  }
 private:
  bool down=false,pending=false,second=false;
  uint32_t pressedAt=0,lastTap=0;
  void reset() {down=false;pending=false;second=false;}
};
} // namespace coco
