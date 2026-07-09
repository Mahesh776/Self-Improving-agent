import { useState, useRef, useEffect } from 'react';
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
  const [state, setState] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');

  const recogRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';
    recogRef.current = r;
    synthRef.current = window.speechSynthesis;
    return () => { r.abort(); synthRef.current?.cancel(); };
  }, []);

  const speak = (text: string): Promise<void> => new Promise((resolve) => {
    const synth = synthRef.current;
    if (!synth) { resolve(); return; }
    synth.cancel();
    const cleaned = stripEmojis(text);
    if (!cleaned) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(cleaned);
    u.lang = 'en-US';
    u.rate = 1;
    u.onend = () => { setState('idle'); resolve(); };
    u.onerror = () => { setState('idle'); resolve(); };
    setState('speaking');
    synth.speak(u);
  });

  const processSpeech = async (text: string) => {
    setState('processing');
    setTranscript(text);
    const userMsg: ChatMessage = { role: 'user', content: text };
    addMessage(userMsg);
    let full = '';
    await new Promise<void>((res) => {
      streamChat(
        [...messages, userMsg], currentModel,
        (c) => { full += c; setResponse(full); },
        () => {}, () => {}, () => res(), () => res(),
      );
    });
    if (full) {
      addMessage({ role: 'assistant', content: full });
      await speak(full);
    } else {
      setState('idle');
    }
  };

  const startMic = () => {
    const r = recogRef.current;
    if (!r) return;
    setError('');
    setTranscript('');
    setResponse('');
    setState('listening');

    r.onresult = (e: any) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setTranscript(final || interim);
      if (final) {
        r.abort();
        processSpeech(final);
      }
    };

    r.onerror = (e: any) => {
      if (e.error === 'aborted') return;
      setState('idle');
      if (e.error === 'no-speech') setError('No speech detected. Try again.');
      else if (e.error === 'audio-capture') setError('No microphone found.');
      else if (e.error === 'not-allowed') setError('Microphone blocked. Allow mic in browser.');
      else setError('Error: ' + e.error);
    };

    r.onend = () => {
      if (state === 'listening') setState('idle');
    };

    try { r.start(); } catch { r.abort(); setTimeout(() => r.start(), 100); }
  };

  const stopMic = () => {
    recogRef.current?.abort();
    setState('idle');
  };

  const stopSpeaking = () => {
    synthRef.current?.cancel();
    setState('idle');
  };

  if (!supported) {
    return (
      <div className="voice-chat-overlay">
        <div className="voice-chat-modal">
          <div className="voice-chat-header"><span>Voice Chat</span><button onClick={onClose}>x</button></div>
          <div className="voice-chat-body"><p>Not supported. Use Chrome or Edge.</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-chat-overlay">
      <div className="voice-chat-modal">
        <div className="voice-chat-header"><span>Voice Chat</span><button onClick={onClose}>x</button></div>
        <div className="voice-chat-body">
          <div className="voice-status">
            {state === 'idle' && 'Click mic to speak'}
            {state === 'listening' && 'Listening... speak now'}
            {state === 'processing' && 'Thinking...'}
            {state === 'speaking' && 'Speaking...'}
          </div>

          {error && <div style={{ color: 'var(--error)', fontSize: '13px' }}>{error}</div>}

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
            {state === 'idle' && (
              <button className="voice-btn mic-btn" onClick={startMic}>MIC</button>
            )}
            {state === 'listening' && (
              <button className="voice-btn stop-btn" onClick={stopMic}>STOP</button>
            )}
            {state === 'processing' && (
              <div className="voice-processing">Thinking...</div>
            )}
            {state === 'speaking' && (
              <button className="voice-btn stop-btn" onClick={stopSpeaking}>MUTE</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
