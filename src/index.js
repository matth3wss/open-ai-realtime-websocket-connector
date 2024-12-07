const recordButton = document.getElementById("recordButton");
let isRecording = false;
let audioStream;
let mediaRecorder;
let webSocket;
let audioContext;
let source;
let audioBufferQueue = [];

let audioContextIn;
let audioContextOut;
let nextBufferTime = 0;

function convertFloat32ToInt16(sample) {
  return Math.max(-32768, Math.min(32767, sample * 32767));
}

function startAudioCapture(ws) {
  navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    })
    .then((stream) => {
      const source = audioContextIn.createMediaStreamSource(stream);
      const processor = audioContextIn.createScriptProcessor(1024, 1, 1);
      source.connect(processor);
      processor.connect(audioContextIn.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const outputData = new Int16Array(inputData.length);

        for (let i = 0; i < inputData.length; i++) {
          outputData[i] = convertFloat32ToInt16(inputData[i]);
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(outputData.buffer);
        }
      };
      isRecording = true;
      recordButton.textContent = "Stop Recording";
    })
    .catch((error) => {
      console.error("getUserMedia error:", error);
    });
  // Initialize WebSocket
}

async function startRecording() {
  try {
    const apiUrl = process.env['WEBSOCKET_API']
    webSocket = new WebSocket(`${apiUrl}/chat123`);

    webSocket.onopen = () => console.log("WebSocket connection established");
    webSocket.onerror = (error) => console.error("WebSocket error:", error);
    webSocket.onclose = () => console.log("WebSocket connection closed");

    webSocket.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const arrayBuffer = reader.result;
          const audioData = new Int16Array(arrayBuffer);

          // Update the latest buffer size
          latestBufferSize = audioData.byteLength;

          if (audioData.length > 0) {
            try {
              await navigator.locks.request("audio-playback", async () => {
                await playAudio(audioData);
              });
            } catch (error) {
              console.error("Error playing audio:", error);
            }
          } else {
            console.log("Received empty audio data after conversion");
          }
        };

        reader.readAsArrayBuffer(event.data);
      } else {
        console.log(event.data);
      }
    };

    await startAudioCapture(webSocket);

    // Get user's audio stream
    // Initialize MediaRecorder
    //   mediaRecorder = new Recorder((event) => {
    //     if (
    //       webSocket.readyState === WebSocket.OPEN &&
    //       event.data.buffer?.byteLength > 0
    //     ) {
    //       chunk = processAudioRecordingBuffer(event.data.buffer);
    //       if (chunk) webSocket.send(chunk);
    //     }
    //   });
    //   // mediaRecorder.ondataavailable =
    //   audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    //   mediaRecorder.start(audioStream); // Sends audio in chunks of 100ms
    //   isRecording = true;
    //   recordButton.textContent = "Stop Recording";
  } catch (error) {
    console.error("Error starting recording:", error);
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  if (audioStream) audioStream.getTracks().forEach((track) => track.stop());
  if (webSocket) {
    console.log("Closing web socket");
    webSocket.close();
  }
  isRecording = false;
  recordButton.textContent = "Start Recording";
}

async function playAudio(int16Array) {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  const audioBuffer = audioContextOut.createBuffer(
    1,
    float32Array.length,
    24000
  );
  audioBuffer.getChannelData(0).set(float32Array);

  const source = audioContextOut.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContextOut.destination);

  const bufferDuration = audioBuffer.length / audioBuffer.sampleRate;
  if (nextBufferTime < audioContextOut.currentTime) {
    nextBufferTime = audioContextOut.currentTime;
  }

  source.start(nextBufferTime);

  nextBufferTime += bufferDuration;
  console.log("Next buffer time:", nextBufferTime);
}

// function playAudio(audioData) {
//   if (!audioContext) audioContext = new AudioContext();

//   audioContext.decodeAudioData(audioData.slice(0), (buffer) => {
//     audioBufferQueue.push(buffer);
//     if (audioBufferQueue.length === 1) {
//       playNextBuffer();
//     }
//   });
// }

function playNextBuffer() {
  if (audioBufferQueue.length === 0) return;

  const buffer = audioBufferQueue.shift();
  source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = playNextBuffer;
  source.start();
}

recordButton.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }

  if (!audioContextIn) {
    audioContextIn = new AudioContext({ sampleRate: 16000 });
    audioContextOut = new AudioContext({ sampleRate: 24000 });
  } else if (audioContextIn.state === "suspended") {
    audioContextIn.resume();
  }
  nextBufferTime = audioContextOut.currentTime;
});

let recordingActive = false;
let buffer = new Uint8Array();

function combineArray(newData) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
}

function processAudioRecordingBuffer(data) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  bufferSize = 4800;
  if (buffer.length >= bufferSize) {
    const toSend = new Uint8Array(buffer.slice(0, bufferSize));
    buffer = new Uint8Array(buffer.slice(bufferSize));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    return base64;
  }
}
