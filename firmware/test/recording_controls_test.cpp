#include "recording_controls.h"
#include <cassert>
#include <cstring>
#include <vector>

using namespace coco;
using State=CaptureState;
using Action=ButtonAction;
int main() {
  // Two quick taps start only a dedicated recording, on the second release.
  BlueButton button;
  assert(button.update(10,true,false,State::Idle)==Action::None);
  assert(button.update(90,false,true,State::Idle)==Action::None);
  assert(button.update(180,true,false,State::Idle)==Action::None);
  assert(button.update(260,false,true,State::Idle)==Action::StartRecording);
  assert(button.update(261,false,false,State::Recording)==Action::None);
  assert(button.update(5000,true,false,State::Recording)==Action::StopRecording);
  assert(button.update(5080,false,true,State::Busy)==Action::None);
  assert(button.update(6000,false,false,State::Idle)==Action::None);

  // Hold-to-chat still starts once and stops on release, never as a recording.
  BlueButton voice;
  assert(voice.update(10,true,false,State::Idle)==Action::None);
  assert(voice.update(309,false,false,State::Idle)==Action::None);
  assert(voice.update(310,false,false,State::Idle)==Action::StartVoice);
  assert(voice.update(1500,false,false,State::Voice)==Action::None);
  assert(voice.update(2500,false,true,State::Voice)==Action::StopVoice);
  assert(voice.update(2501,false,false,State::Busy)==Action::None);

  // A held second press is chat, not a latched recording.
  BlueButton tapThenHold;
  tapThenHold.update(0,true,false,State::Idle);
  tapThenHold.update(90,false,true,State::Idle);
  tapThenHold.update(180,true,false,State::Idle);
  assert(tapThenHold.update(480,false,false,State::Idle)==Action::StartVoice);
  assert(tapThenHold.update(1000,false,true,State::Voice)==Action::StopVoice);

  // One tap, a slow pair, simultaneous NFC use, and taps during playback do nothing.
  BlueButton slow;
  slow.update(0,true,false,State::Idle);slow.update(50,false,true,State::Idle);
  assert(slow.update(1000,true,false,State::Idle)==Action::None);
  assert(slow.update(1050,false,true,State::Idle)==Action::None);
  for(const auto state:{State::Idle,State::Busy}) {
    BlueButton blocked;
    blocked.update(0,true,false,state,true);blocked.update(50,false,true,state,true);
    blocked.update(100,true,false,state,true);
    assert(blocked.update(150,false,true,state,true)==Action::None);
    assert(blocked.update(500,false,false,State::Idle)==Action::None);
  }
  BlueButton interrupt;
  interrupt.update(0,true,false,State::Idle);interrupt.update(50,false,true,State::Idle);
  interrupt.update(80,false,false,State::Idle,true);
  interrupt.update(100,true,false,State::Idle);
  assert(interrupt.update(150,false,true,State::Idle)==Action::None);

  // A press stops even during recording warm-up; its release cannot start chat.
  BlueButton cancel;
  assert(cancel.update(50,true,false,State::Recording)==Action::StopRecording);
  assert(cancel.update(80,false,true,State::Idle)==Action::None);
  assert(cancel.update(1000,false,false,State::Idle)==Action::None);

  // Failed self-tests release capture/audio ownership. Even a stale test flag
  // cannot make later chat or recording presses permanently Busy.
  const auto recovered=buttonCaptureState(false,false,true,CaptureKind::Voice);
  assert(recovered==State::Idle);
  BlueButton retryVoice,retryRecording;
  retryVoice.update(0,true,false,recovered);
  assert(retryVoice.update(300,false,false,recovered)==Action::StartVoice);
  retryRecording.update(0,true,false,recovered);retryRecording.update(50,false,true,recovered);
  retryRecording.update(100,true,false,recovered);
  assert(retryRecording.update(150,false,true,recovered)==Action::StartRecording);
  assert(buttonCaptureState(true,true,true,CaptureKind::Voice)==State::Busy);
  assert(buttonCaptureState(false,true,true,CaptureKind::Voice)==State::Busy);
  assert(buttonCaptureState(true,true,false,CaptureKind::Recording)==State::Recording);
  assert(buttonCaptureState(true,true,false,CaptureKind::Voice)==State::Voice);

  // Wraparound cannot turn a stale tap into a hold or lose a legitimate double tap.
  BlueButton wrap;
  wrap.update(0xffffff90U,true,false,State::Idle);
  wrap.update(0xffffffd0U,false,true,State::Idle);
  wrap.update(20,true,false,State::Idle);
  assert(wrap.update(60,false,true,State::Idle)==Action::StartRecording);

  // Recording speech is routed to the action-free endpoint, never the chat agent.
  assert(!strcmp(capturePath(CaptureKind::Recording),"/v1/recordings"));
  assert(!strcmp(capturePrefix(CaptureKind::Recording),"recording"));
  assert(!strcmp(capturePath(CaptureKind::Voice),"/v1/voice"));
  assert(captureSamples(CaptureKind::Voice)==kMaxSamples);
  assert(captureSeconds(CaptureKind::Recording,120)==60);
  assert(captureSeconds(CaptureKind::Recording,30)==30);
  assert(captureSamples(CaptureKind::Recording,0)==0);
  const auto samples=captureSamples(CaptureKind::Recording);
  std::vector<uint8_t> wav(kWavHeader+samples*2);
  wavHeader(wav.data(),samples);Wav parsed;
  assert(wav.size()==1920044 && wav.size()<2000000);
  assert(parseWav(wav.data(),wav.size(),parsed));
  assert(parsed.rate==16000 && parsed.channels==1 && parsed.samples==960000);
  assert(u32(wav.data()+40)==1920000);
}
