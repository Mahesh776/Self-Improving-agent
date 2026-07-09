import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../state/store';
import { streamChat, type ChatMessage } from '../api/client';

interface VoiceChatProps {
  onClose: () => void;
}

export default function VoiceChat({ onClose }: VoiceChatProps) {
  const { messages, currentModel, addMessage, updateLastAssistant } = useStore();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('Click mic to start');
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setStatus('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
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
        handleUserSpeech(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'no-speech') {
        setStatus('No speech detected. Try again.');
      } else if (event.error === 'audio-capture') {
        setStatus('No microphone found.');
      } else {
        setStatus(`Error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    synthRef.current = window.speechSynthesis;

    return () => {
      recognition.abort();
      synthRef.current?.cancel();
    };
  }, []);

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

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!synthRef.current) {
        resolve();
        return;
      }
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 1;
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };
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
        (content) => {
          fullResponse += content;
          setResponse(fullResponse);
        },
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

    setStatus('Click mic to speak again');
  }, [messages, currentModel, addMessage, speak]);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
    setStatus('Click mic to speak again');
  }, []);

  if (!supported) {
    return (
      <div className="voice-chat-overlay">
        <div className="voice-chat-modal">
          <div className="voice-chat-header">
            <span>Voice Chat</span>
            <button onClick={onClose}>x</button>
          </div>
          <div className="voice-chat-body">
            <p>Speech recognition is not supported in this browser. Use Chrome or Edge.</p>
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
              <p>{response}</p>
            </div>
          )}

          <div className="voice-controls">
            {!isListening && !isProcessing && !isSpeaking && (
              <button className="voice-btn mic-btn" onClick={startListening} title="Start listening">
                MIC
              </button>
            )}
            {isListening && (
              <button className="voice-btn stop-btn" onClick={stopListening} title="Stop listening">
                STOP
              </button>
            )}
            {isSpeaking && (
              <button className="voice-btn stop-btn" onClick={stopSpeaking} title="Stop speaking">
                MUTE
              </button>
            )}
            {isProcessing && (
              <div className="voice-processing">Processing...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
