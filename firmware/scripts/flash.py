#!/usr/bin/env python3
"""Refuse to flash unless USB identity AND eFuse MAC match an explicitly named badge."""
import argparse,pathlib,subprocess,sys
from serial.tools import list_ports
p=argparse.ArgumentParser()
p.add_argument('--port',required=True)
p.add_argument('--expected-mac',required=True)
p.add_argument('--pio',default='pio')
a=p.parse_args()
d=next((d for d in list_ports.comports() if d.device==a.port),None)
if not d or (d.serial_number or '').lower()!=a.expected_mac.lower():
    raise SystemExit('USB identity mismatch. Nothing flashed.')
r=subprocess.run([sys.executable,'-m','esptool','--chip','esp32s3','--port',a.port,'read-mac'],text=True,capture_output=True)
import re
matches=re.findall(r'\bMAC:\s*([0-9a-f:]{17})',r.stdout,re.I)
if r.returncode or a.expected_mac.lower() not in [x.lower() for x in matches]:
    raise SystemExit('eFuse identity check failed. Nothing flashed.')
print('Verified selected badge identity. Flashing credential-free firmware.',flush=True)
subprocess.run([a.pio,'run','--project-dir',str(pathlib.Path(__file__).resolve().parents[1]),'--target','upload','--upload-port',a.port],check=True)
