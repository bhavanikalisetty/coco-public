#!/usr/bin/env python3
"""Provision a single identified badge over USB without compiling secrets."""
import argparse,json,pathlib,time
import serial
from serial.tools import list_ports

p=argparse.ArgumentParser()
p.add_argument('action',choices=['identity','provision','test_audio','nfc_reader','nfc_emulator','monitor'])
p.add_argument('--port',required=True)
p.add_argument('--config',type=pathlib.Path)
p.add_argument('--expected-mac',required=True)
p.add_argument('--seconds',type=int,default=30)
a=p.parse_args()
ports={d.device:d for d in list_ports.comports()}
d=ports.get(a.port)
if not d or (d.serial_number or '').lower()!=a.expected_mac.lower():
    raise SystemExit('USB identity does not match the explicitly selected badge. No data sent.')
s=serial.Serial(exclusive=True);s.port=a.port;s.baudrate=115200;s.timeout=.2;s.dtr=False;s.rts=False;s.open()
if a.action=='provision':
    if not a.config:raise SystemExit('--config required')
    c=json.loads(a.config.read_text())
    if c.get('expectedMac','').lower()!=a.expected_mac.lower():raise SystemExit('Provisioning identity mismatch')
    keys=['ssid','password','token','nfcToken','deviceId']
    if any(k not in c for k in keys):raise SystemExit('Local configuration is incomplete')
    s.write(('provision '+json.dumps({k:c[k] for k in keys},separators=(',',':'))+'\n').encode())
elif a.action!='monitor':s.write((a.action+'\n').encode())
# Only structured device diagnostics are printed, never provisioning or raw serial echoes.
until=time.monotonic()+a.seconds
while time.monotonic()<until:
    line=s.readline().decode(errors='replace').strip()
    if line.startswith('COCO_'):print(line,flush=True)
s.close()
