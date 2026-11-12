#!/usr/bin/env python3
"""Monitor two explicitly identified USB badges; type 'arm' to start one local NFC test."""
import argparse,select,sys,time
import serial
from serial.tools import list_ports
p=argparse.ArgumentParser()
p.add_argument('--emulator-port',required=True);p.add_argument('--emulator-mac',required=True)
p.add_argument('--reader-port',required=True);p.add_argument('--reader-mac',required=True)
p.add_argument('--seconds',type=int,default=300)
a=p.parse_args();ports={d.device:d for d in list_ports.comports()}
selected=[('emulator',a.emulator_port,a.emulator_mac),('reader',a.reader_port,a.reader_mac)]
if a.emulator_port==a.reader_port or a.emulator_mac.lower()==a.reader_mac.lower():raise SystemExit('Two distinct badges are required')
for _,port,mac in selected:
 if port not in ports or (ports[port].serial_number or '').lower()!=mac.lower():raise SystemExit('Badge identity mismatch. No commands sent.')
connections=[]
for role,port,_ in selected:
 s=serial.Serial(exclusive=True);s.port=port;s.baudrate=115200;s.timeout=.1;s.dtr=False;s.rts=False;s.open();s.write(b'identity\n');connections.append((role,s))
print("Monitoring identified badges. Type 'arm' to arm emulator then reader, or 'quit'.",flush=True)
pending_reader=False
buffers={role:bytearray() for role,_,_ in selected}
until=time.monotonic()+a.seconds
try:
 while time.monotonic()<until:
  ready,_,_=select.select([sys.stdin]+[s for _,s in connections],[],[],.2)
  if sys.stdin in ready:
   command=sys.stdin.readline().strip()
   if command=='quit':break
   if command=='arm':
    connections[0][1].write(b'nfc_emulator\n');pending_reader=True
    print('Explicit local NFC arm requested; reader waits for emulator readiness.',flush=True)
  for role,s in connections:
   if s in ready:
    buffers[role].extend(s.read(max(1,s.in_waiting)))
    while b'\n' in buffers[role]:
     raw,_,rest=buffers[role].partition(b'\n');buffers[role]=bytearray(rest)
     line=raw.decode(errors='replace').strip()
     if line.startswith('COCO_'):print(role,line,flush=True)
     if pending_reader and role=='emulator' and line=='COCO_NFC_ARM role=emulator ok=1':
      connections[1][1].write(b'nfc_reader\n');pending_reader=False
finally:
 for _,s in connections:s.close()
