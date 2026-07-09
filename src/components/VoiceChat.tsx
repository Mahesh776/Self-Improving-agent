import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../state/store';
import { streamChat, type ChatMessage } from '../api/client';

interface VoiceChatProps {
  onClose: () => void;
}

function stripEmojis(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?/gu, '')
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[:;][\-\)?]+/g, '')
    .trim();
}

export default function VoiceChat({ onClose }: VoiceChatProps) {
  const { messages, currentModel, addMessage } = useStore();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('Click mic to start');
  const [supported, setSupported] = useState(true);
  const [micActive, setMicActive] = useState(false);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const micActiveRef = useRef(false);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setTranscript('');
    setResponse('');
    setIsListening(true);
    setStatus('Listening... speak now');
    try {
      recognitionRef.current.start();
    } catch (e) {
      recognitionRef.current.stop();
      setTimeout(() => recognitionRef.current.start(), 100);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!synthRef.current) { resolve(); return; }
      synthRef.current.cancel();
      const cleaned = stripEmojis(text);
      if (!cleaned) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = 'en-US';
      utterance.rate = 1;
      utterance.onend = () => { setIsSpeaking(false); resolve(); };
      utterance.onerror = () => { setIsSpeaking(false); resolve(); };
      setIsSpeaking(true);
      setStatus('Speaking...');
      synthRef.current.speak(utterance);
    });
  }, []);

  const handleUserSpeech = useCallback(async (text: string) => {
    setIsListening(false);
    setIsProcessing(true);
    setStatus('Thinking...');

    const userMsg: ChatMessage = { role: 'user', content: text };
    addMessage(userMsg);

    let fullResponse = '';
    await new Promise<void>((resolve) => {
      streamChat(
        [...messages, userMsg],
        currentModel,
        (content) => { fullResponse += content; setResponse(fullResponse); },
        () => {},
        () => {},
        () => resolve(),
        () => resolve(),
      );
    });

    setIsProcessing(false);

    if (fullResponse) {
      addMessage({ role: 'assistant', content: fullResponse });
      await speak(fullResponse);
    }

    if (micActiveRef.current) {
      setStatus('Listening... speak again');
      startListening();
    } else {
      setStatus('Click mic to start');
    }
  }, [messages, currentModel, addMessage, speak, startListening]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setStatus('Speech recognition not supported. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interimTranscript += t;
        }
      }
      setTranscript(finalTranscript || interimTranscript);
      if (finalTranscript) {
        recognition.stop();
        handleUserSpeech(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        if (micActiveRef.current) {
          setStatus('Listening... speak now');
          try { recognition.start(); } catch {}
        }
        return;
      }
      if (event.error === 'aborted') return;
      console.error('Speech error:', event.error);
      if (event.error === 'audio-capture') {
        setStatus('No microphone found.');
        setMicActive(false);
        micActiveRef.current = false;
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (micActiveRef.current && !isProcessing) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    synthRef.current = window.speechSynthesis;

    return () => {
      recognition.abort();
      synthRef.current?.cancel();
    };
  }, [handleUserSpeech, isProcessing]);

  const toggleMic = useCallback(() => {
    if (micActiveRef.current) {
      micActiveRef.current = false;
      setMicActive(false);
      stopListening();
      synthRef.current?.cancel();
      setIsSpeaking(false);
      setStatus('Mic off');
    } else {
      micActiveRef.current = true;
      setMicActive(true);
      startListening();
    }
  }, [startListening, stopListening]);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
    if (micActiveRef.current) {
      setStatus('Listening... speak now');
      startListening();
    } else {
      setStatus('Click mic to start');
    }
  }, [startListening]);

  if (!supported) {
    return (
      <div className="voice-chat-overlay">
        <div className="voice-chat-modal">
          <div className="voice-chat-header">
            <span>Voice Chat</span>
            <button onClick={onClose}>x</button>
          </div>
          <div className="voice-chat-body">
            <p>Speech recognition not supported. Use Chrome or Edge.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-chat-overlay">
      <div className="voice-chat-modal">
        <div className="voice-chat-header">
          <span>Voice Chat</span>
          <button onClick={onClose}>x</button>
        </div>
        <div className="voice-chat-body">
          <div className="voice-status">{status}</div>

          {transcript && (
            <div className="voice-transcript">
              <label>You said:</label>
              <p>{transcript}</p>
            </div>
          )}

          {response && (
            <div className="voice-response">
              <label>Manus says:</label>
              <p>{stripEmojis(response)}</p>
            </div>
          )}

          <div className="voice-controls">
            <button
              className={`voice-btn mic-btn ${micActive ? 'mic-active' : ''}`}
              onClick={toggleMic}
              title={micActive ? 'Turn mic off' : 'Turn mic on'}
            >
              {micActive ? 'ON' : 'MIC'}
            </button>
            {isSpeaking && (
              <button className="voice-btn stop-btn" onClick={stopSpeaking} title="Mute">
                MUTE
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
