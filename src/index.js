const recordButton = document.getElementById("recordButton");
let isRecording = false;
let audioStream;
let mediaRecorder;
let webSocket;
let audioContext;
let source;
/**
 * Audio buffer queue
 * @type {Int16Array[]}
 */
let audioBufferQueue = [];

let audioContextIn;
let audioContextOut;
let nextBufferTime = 0;

let fullAudio = [];

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

    })
    .catch((error) => {
      console.error("getUserMedia error:", error);
    });
  // Initialize WebSocket
}

let isRecordingWebSocket = false; // Flag to track if WebSocket is for recording

async function startRecording() {
  try {
    const inputUrl = document.querySelector("#wsUrl")?.value;
    const inputLanguage = document.querySelector("#language")?.value;
    const useRealtime = document.querySelector("#useRealtime")?.checked; // Check the toggle
    const channel = document.querySelector("#username")?.value; // Use username as channel
    const authorization = "Bearer your-token-here"; // Replace with your actual token or leave empty if not required

    let baseUrl = inputUrl.trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }

    const fullWsUrl = useRealtime
      ? `${baseUrl.replace(/^http/, 'ws')}/realtime/${channel}`
      : `${baseUrl.replace(/^http/, 'ws')}/ws/chat/${channel}?language=${inputLanguage}`; // Adjusted for normal endpoint
    console.log("Connecting to WebSocket URL:", fullWsUrl);

    webSocket = new WebSocket(fullWsUrl);
    isRecordingWebSocket = true; // Mark WebSocket as used for recording

    isRecording = true;
    recordButton.textContent = "Stop Recording";

    webSocket.onopen = async () => {
      const msg = { type: "choose_sale_chat_type", value: '' };
      webSocket.send(JSON.stringify(msg));

      if (!audioContextOut) {
        audioContextOut = new AudioContext({ sampleRate: 24000 });
        nextBufferTime = audioContextOut.currentTime;
      }

      startAudioCapture(webSocket);
    };

    webSocket.onerror = (error) => {
      stopRecording();
      console.error("WebSocket error:", error);
    };

    webSocket.onclose = () => {
      stopRecording();
      console.log("WebSocket connection closed");
    };

    webSocket.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const arrayBuffer = reader.result;
          const audioData = new Int16Array(arrayBuffer);

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
      } else if (typeof event.data === "string") {
        try {
          const parsedData = JSON.parse(event.data);
          if (parsedData.type === "audio_response" && parsedData.audio) {
            const audioBuffer = Uint8Array.from(atob(parsedData.audio), (c) =>
              c.charCodeAt(0)
            );
            const int16Array = new Int16Array(
              audioBuffer.buffer,
              audioBuffer.byteOffset,
              audioBuffer.byteLength / Int16Array.BYTES_PER_ELEMENT
            );
            await playAudio(int16Array);
          } else {
            console.log("Received non-audio message:", parsedData);
          }
        } catch (error) {
          console.error("Error processing WebSocket message:", error);
        }
      }
    };
  } catch (error) {
    console.error("Error starting recording:", error);
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  if (audioStream) audioStream.getTracks().forEach((track) => track.stop());
  if (webSocket && isRecordingWebSocket) {
    console.log("Closing web socket");
    webSocket.close(); // Only close if it was used for recording
    isRecordingWebSocket = false; // Reset the flag
  }

  // Stop any ongoing audio playback
  if (audioContextOut) {
    audioContextOut.close().then(() => {
      audioContextOut = null; // Reset the audio context
      nextBufferTime = 0; // Reset the buffer time
    });
  }

  // Clear the audio buffer queue
  audioBufferQueue = [];

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

/**
 *
 * @param {SubmitEvent} ev
 * @returns
 */
function submit(ev) {
  ev.preventDefault()  // to stop the form submitting
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
  return false;
};

document.querySelector('form').onsubmit = submit;

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

function toggleEndpointLabel(reload = false) {
  const checkbox = document.getElementById('useRealtime');
  const label = document.getElementById('endpointLabel');
  const messageInputContainer = document.getElementById('messageInputContainer');
  const sendMessageButton = document.getElementById('sendMessageButton');

  label.textContent = checkbox.checked ? 'Realtime' : 'Normal';
  messageInputContainer.style.display = checkbox.checked ? 'block' : 'none';
  sendMessageButton.style.display = checkbox.checked ? 'block' : 'none';

  // Reload the recording state if required
  if (reload && isRecording) {
    stopRecording();
    startRecording();
  }
}

// Ensure correct visibility of username input and send message button on page load
document.addEventListener('DOMContentLoaded', () => {
  toggleEndpointLabel();
});
