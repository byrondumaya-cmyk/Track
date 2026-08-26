import serial, time
s = serial.Serial('COM7', 115200, timeout=2)
s.flushInput()
time.sleep(2)
data = b''
for _ in range(10):
    chunk = s.read(4096)
    data += chunk
    if chunk:
        time.sleep(1)
print(data.decode('ascii', 'ignore'), end='')
s.close()
