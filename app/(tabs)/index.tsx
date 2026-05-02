import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session'; // 💡 これを追加！
import * as Google from 'expo-auth-session/providers/google';
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// 💡 指定したミリ秒だけ待機するツール
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const getFormattedDate = () => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日_${d.getHours()}時${d.getMinutes().toString().padStart(2, '0')}分`;
};
const MODEL_NAME = 'gemini-3-flash-preview';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbziUAoYqpUZ4rdoNzJACoNe_RVoQg1qMI9PqiND7x_x8_P3cNjWHChSH6yjfO9yTqDt/exec';

let capturedCode: string | null = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  capturedCode = urlParams.get('code');
}

// 💡 修正：PC版でのみ掃除機能を動かし、スマホWebでは完全に停止させる（勝手に画面が閉じるのを防ぐ）
if (Platform.OS !== 'web' || !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
  WebBrowser.maybeCompleteAuthSession();
}

// 💡 取得した通行証の番号（クライアントID）
const GOOGLE_CLIENT_ID = '942775066824-6jtgm5jbelugran6jc7bl6rblkm2n7vk.apps.googleusercontent.com';
interface HistoryItem {
  id: string;
  date: string;
  minutes: string;
  status: 'success' | 'failed';
  audioFileId?: string | null;
}

// 💡 12行目付近
export default function HomeScreen() {
  const [recording, setRecording] = useState<Audio.Recording | undefined>();
  const [status, setStatus] = useState('待機中');
  const [minutes, setMinutes] = useState<string>(""); 
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]); 
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0); 
  const [isHistoryModalVisible, setHistoryModalVisible] = useState(false); 
  
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tvnFolderId, setTvnFolderId] = useState<string | null>(null);
  const usedCodeRef = useRef<string | null>(null);
  
  // 💡 追加：設定メニューの表示スイッチ
  const [isMenuVisible, setMenuVisible] = useState(false);

  const [logs, setLogs] = useState<string[]>([]); // 💡 ログを保存する配列
  const [showLogModal, setShowLogModal] = useState(false);
  // --- 💡 追加：分割された議事録を一時保存する箱 ---
  const [minutesParts, setMinutesParts] = useState<string[]>([]);
  const minutesPartsRef = useRef<string[]>([]); // 同期的な処理のためにRefも用意
  const thirtyMinTimerRef = useRef<NodeJS.Timeout | null>(null);
  

  // 💡 ログを追加する関数
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 50)]); // 最新50件を保持
    console.log(`[LOG] ${msg}`);
  };
  // 💡 追加：ログアウト処理
  const handleLogout = async () => {
    setAccessToken(null);
    setTvnFolderId(null);
    setStatus('ログアウトしました');
    Alert.alert("ログアウト", "ログアウトしました。");
  };

 // 💡 修正: 許可するドメインに @toho-next.com を追加します
  const ALLOWED_DOMAINS = ['@toho.co.jp', '@gmail.com', '@toho-next.com', '@toho-house.co.jp'];

  const redirectUri = Platform.OS === 'web' && typeof window !== 'undefined' 
    ? window.location.origin + window.location.pathname 
    : AuthSession.makeRedirectUri();

const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_CLIENT_ID,      
    webClientId: GOOGLE_CLIENT_ID,   
    iosClientId: GOOGLE_CLIENT_ID,   
    androidClientId: GOOGLE_CLIENT_ID, 
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email' 
    ],
    redirectUri: redirectUri, 
    responseType: 'code', 
    usePKCE: false, // 💡 修正：true から false に変更！
    extraParams: {
      access_type: 'offline', 
      prompt: 'consent',     
    },
  });

// 💡 ログイン成功時の処理
  useEffect(() => {
    async function processLogin() {
      let codeToUse = null;

      if (response?.type === 'success') {
        codeToUse = response.params.code;
      } else if (capturedCode) {
        codeToUse = capturedCode;
      }

      if (codeToUse && usedCodeRef.current !== codeToUse) {
        usedCodeRef.current = codeToUse;
        capturedCode = null;

        console.log("💡 鍵の交換を開始します！");
        // 💡 修正：パスワードの読み出し処理・削除処理を丸ごと削除し、シンプルに codeToUse だけ渡す
        exchangeCodeForTokens(codeToUse); 

        if (Platform.OS === 'web') {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }
    processLogin();
  }, [response]);

// 💡 修正：引数から codeVerifier を削除
  async function exchangeCodeForTokens(code: string) {
    try {
      setStatus('最新の鍵を取得中...');
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain', 
        },
        body: JSON.stringify({
          action: 'exchangeCode',
          code: code,
          redirectUri: redirectUri
          // 💡 修正：codeVerifier の行を丸ごと削除！
        })
      });

      if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`);
      const data = await res.json();
      
      if (data.access_token) {
        setAccessToken(data.access_token);
        if (data.refresh_token) {
          await AsyncStorage.setItem('refresh_token', data.refresh_token);
        }
        checkUserDomain(data.access_token);
      } else {
        throw new Error(JSON.stringify(data));
      }
    } catch (error: any) {
      console.error(error);
      setStatus('認証エラー: ' + error.message.substring(0, 50)); 
      Alert.alert("認証エラー", "詳細: " + error.message);
    }
  }

  async function checkUserDomain(token: string) {
    try {
      setStatus('ユーザー情報を確認中...');
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userInfo = await res.json();
      
      if (!userInfo || !userInfo.email) {
        throw new Error("メールアドレスの取得に失敗しました");
      }

      const isAllowed = ALLOWED_DOMAINS.some(domain => userInfo.email.endsWith(domain));
      
      if (isAllowed) {
        setAccessToken(token); 
        setStatus(`待機中`);
        Alert.alert("認証成功", `${userInfo.email}\nでログインしました。`);
      } else {
        setAccessToken(null); 
        setStatus('ブロックされました（許可されていないドメインです）');
        Alert.alert("アクセス拒否", "許可された社内アカウントでログインしてください。");
      }
    } catch (error) {
      console.error(error);
      setStatus('認証エラー');
      Alert.alert("エラー", "ユーザー情報の確認に失敗しました。");
    }
  }
async function setupDriveAndConfig() {
    // 💡 修正：最初に最新の鍵を準備する
    const currentToken = await getValidToken();
    if (!currentToken) throw new Error("Googleにログインしていません");

    setStatus('📁 Drive内をチェック中...');
    let folderId = null;

    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='TVN' and mimeType='application/vnd.google-apps.folder' and trashed=false`, {
      headers: { Authorization: `Bearer ${currentToken}` } // 💡 accessTokenをcurrentTokenに変更
    });
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      folderId = searchData.files[0].id;
      setTvnFolderId(folderId);
      console.log("✅ 既存のTVNフォルダを発見 ID:", folderId);
    } else {
      setStatus('✨ TVNフォルダを新規作成中...');
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`, // 💡 ここも変更
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          name: 'TVN', 
          mimeType: 'application/vnd.google-apps.folder' 
        })
      });
      const createData = await createRes.json();
      folderId = createData.id;
      setTvnFolderId(folderId);
      
      console.log("🚀 新しく作成されたフォルダの直リンク: https://drive.google.com/drive/folders/" + folderId);
      Alert.alert("フォルダ作成完了", "ドライブに「TVN」フォルダを作成しました。");
    }

    setStatus('✅ 準備完了！');
  }

  // --- この下からは既存のコード（const recordingRef = useRef... 以降）が続きます ---
  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationTimerRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const chunksTextRef = useRef<string[]>([]); 
  const audioFilesRef = useRef<string[]>([]); 

  const getFormattedTime = () => {
    const h = Math.floor(duration / 3600);
    const m = Math.floor((duration % 3600) / 60);
    const s = duration % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const saved = await AsyncStorage.getItem('meeting_history');
    if (saved) setHistory(JSON.parse(saved));
  }

// 💡 修正1：保存時に必ず「最新のデータ」を取得して書き込む（増殖バグを防止）
async function saveToHistory(minutes: string, status: boolean, audioFileId?: string | null) {
  const newItem: HistoryItem = {
    id: Date.now().toString(),
    minutes: minutes,
    audioFileId: audioFileId || undefined, 
    status: status ? 'success' : 'failed',
    date: new Date().toLocaleString(),
  };

  // 💡 ストレージから最新の履歴を読み込む
  const saved = await AsyncStorage.getItem('meeting_history');
  const currentHistory: HistoryItem[] = saved ? JSON.parse(saved) : [];
  
  const newHistory = [newItem, ...currentHistory];
  setHistory(newHistory);
  await AsyncStorage.setItem('meeting_history', JSON.stringify(newHistory));
}

  async function startNewRecordingSession() {
    await Audio.setAudioModeAsync({ 
      allowsRecordingIOS: true, 
      playsInSilentModeIOS: true,
      staysActiveInBackground: true, 
    });
    const { recording: newRecording } = await Audio.Recording.createAsync({
      android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
      ios: { extension: '.m4a', audioQuality: 0, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
      web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
    });
    recordingRef.current = newRecording; 
    setRecording(newRecording); 
  }

async function startRecording() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync({
        android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
        ios: { extension: '.m4a', audioQuality: 0, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
        web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
      });

      recordingRef.current = newRecording;
      setRecording(newRecording);
      setIsRecording(true);
      setDuration(0);

      setupDriveAndConfig().catch(console.error); 
      activateKeepAwakeAsync().catch(console.error);

      chunksTextRef.current = [];
      audioFilesRef.current = [];
      setMinutes(""); 

      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      setStatus('録音中...');

      // 💡 3分ごとの裏側文字起こしタイマー
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        processChunkInBg();
      }, 180000);

      // 💡 追加：30分ごとの「自動リレー」タイマー
      if (thirtyMinTimerRef.current) clearInterval(thirtyMinTimerRef.current);
      thirtyMinTimerRef.current = setInterval(() => {
        relayRecording();
      }, 1800000) as any;

    } catch (err) { 
      console.error(err);
      setStatus('録音開始エラー');
    }
  }

  

  async function processChunkInBg() {
    if (!recordingRef.current) return;
    const oldRec = recordingRef.current;
    
    try {
      await oldRec.stopAndUnloadAsync();
      const uri = oldRec.getURI();

      await startNewRecordingSession(); 

      if (!uri) return;

      audioFilesRef.current.push(uri);
      setStatus(`録音中... (裏で文字起こし進行中)`);

      const transcribedText = await transcribeAudio(uri);
      chunksTextRef.current.push(transcribedText);
      
    } catch (e) {
      console.error("分割文字起こし・切替エラー", e);
    }
  }
// 💡 新機能：30分ごとのリレー処理
  async function relayRecording() {
    addLog("🕒 30分経過：リレー処理を開始します");
    // 現在の録音をリレー用として停止
    await stopRecording(true); 
    // すぐに次の録音を開始
    await startRecording();
  }

async function stopRecording(isRelay = false) {
    let audioId = null;
    let currentBlockText = "";

    try {
      setStatus(isRelay ? '30分経過：中間解析中...' : '録音を停止中...');
      setLoading(true);

      // 💡 本当の終了時のみタイマーを全解除
      if (!isRelay) {
        if (thirtyMinTimerRef.current) clearInterval(thirtyMinTimerRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      }

      let finalUri = "";
      if (recording) {
        await recording.stopAndUnloadAsync();
        finalUri = recording.getURI() || "";
        setRecording(undefined);
        recordingRef.current = null;
      }

      // 1️⃣ 音声ファイルをDriveへ保存
      const partNum = minutesPartsRef.current.length + 1;
      const audioFileName = `音声_${getFormattedDate()}_Part${partNum}.webm`;
      audioId = await uploadAudioToDrive(finalUri, audioFileName);

      // 2️⃣ 直近の文字起こしを完了させる
      if (finalUri) {
        const text = await transcribeAudio(finalUri);
        if (text) chunksTextRef.current.push(text);
      }
      currentBlockText = chunksTextRef.current.join('\n');
      chunksTextRef.current = []; // 💡 次の30分のためにリセット

      // 3️⃣ この30分間だけの「中間議事録」を作成
      if (currentBlockText.trim().length > 0) {
        addLog(`📦 Part${partNum} の中間解析を開始`);
        const partMinutes = await generatePartialMinutes(currentBlockText);
        minutesPartsRef.current.push(partMinutes);
        setMinutesParts([...minutesPartsRef.current]);
      }

      // 🏁 もし「本当の停止」ボタンなら、全てを合体させて保存
      if (!isRelay) {
        const finalFullMinutes = minutesPartsRef.current.length > 0 
          ? minutesPartsRef.current.join('\n\n---\n\n') 
          : "(解析データがありません)";

        setMinutes(finalFullMinutes);
        await saveToHistory(finalFullMinutes, true, audioId);
        
        // データの初期化
        minutesPartsRef.current = [];
        setMinutesParts([]);
        deactivateKeepAwake();
        setLoading(false);
        setStatus('全ての処理が完了！');
      } else {
        // リレー時は「ぐるぐる」を消して次の録音の邪魔をしない
        setLoading(false);
        setStatus('リレー完了：録音継続中');
      }

    } catch (err: any) {
      console.error("停止処理エラー:", err);
      setLoading(false);
      deactivateKeepAwake();
      await saveToHistory(`(エラー中断) ${err.message}\n${currentBlockText}`, false, audioId);
      setStatus('エラー中断(音声保存済)');
    }
  }

  // 💡 新機能：中間議事録を作る専用の関数
  async function generatePartialMinutes(text: string) {
    try {
      const prompt = `以下の会議内容（約30分間分）を、要約して議事録にしてください。Markdown記号（#や*）は禁止です。\n\n${text}`;
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'generateMinutes', promptText: prompt }),
      });
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      return `(中間解析失敗)\n${text}`;
    }
  }

async function uploadAudioToDrive(uri: string, fileName: string): Promise<string | null> {
    try {
      const currentToken = await getValidToken(); // 💡 追加
      if (!currentToken || !tvnFolderId) return null;
      
      const response = await fetch(uri);
      const blob = await response.blob();
      
      const metadata = { name: fileName, parents: [tvnFolderId] };
      const formData = new FormData();
      formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      formData.append('file', blob);

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` }, // 💡 変更
        body: formData
      });

      const fileData = await uploadRes.json();
      console.log("音声バックアップ成功 ID:", fileData.id);
      return fileData.id; 

    } catch (e) {
      console.error("音声バックアップ失敗:", e);
      return null;
    }
  }

// 💡 新規追加：有効な通行証を返す関数（切れていたら合鍵で更新する）
  async function getValidToken() {
    const refreshToken = await AsyncStorage.getItem('refresh_token');
    if (!refreshToken) return accessToken;

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain', // 💡 こちらにも復活させる！
        },
        body: JSON.stringify({
          action: 'refreshToken',
          refreshToken: refreshToken
        })
      });
      const data = await res.json();
      
      if (data.access_token) {
        setAccessToken(data.access_token);
        return data.access_token;
      }
    } catch (e) {
      console.error("鍵の自動更新に失敗しました:", e);
    }
    return accessToken;
  }

async function transcribeAudio(fileInput: string | Blob): Promise<string> {
  const maxRetries = 5;
  let waitTime = 30000; 

  addLog(`🎤 文字起こしリクエスト開始 (モデル設定: ${MODEL_NAME})`); // 💡 ログ追加

  for (let i = 0; i < maxRetries; i++) {
    try {
      setStatus(`文字起こし中... (${i + 1}/${maxRetries}回目)`);
      
      let blob: Blob;
      if (typeof fileInput === 'string') {
        const response = await fetch(fileInput);
        blob = await response.blob();
      } else {
        blob = fileInput;
      }

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;

      addLog(`📡 GASへ送信中... (URL: ${GAS_URL.substring(0, 40)}...)`); // 💡 ログ追加

      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'transcribe',
          audioData: base64Data,
          mimeType: blob.type || 'audio/webm'
        })
      });
      const data = await response.json();
      
      if (data.error) {
        addLog(`❌ GAS側でエラー発生: ${data.error}`); // 💡 ログ追加
        throw new Error(data.error); 
      }

      addLog(`✅ 文字起こし成功 (${data.candidates[0].content.parts[0].text.substring(0, 20)}...)`); // 💡 ログ追加
      return data.candidates[0].content.parts[0].text;

    } catch (err: any) {
      addLog(`⚠️ 通信失敗: ${err.message}`); // 💡 ログ追加

      // 💡 修正：コメント部分を「503」や「demand」を判別するコードに置き換えます
      if (i < maxRetries - 1 && (err.message.includes("503") || err.message.includes("demand") || err.message.includes("timeout") || err.message.includes("Failed to fetch") || err.message.includes("Load failed") || err.message.includes("Network request failed"))) {
        
        // 💡 混雑回避のため、30秒〜40秒の間でランダムに待機時間をずらす（Jitter）
        const jitter = Math.random() * 10000; 
        const totalWait = waitTime + jitter;

        addLog(`🔄 混雑回避のため ${Math.round(totalWait / 1000)}秒後にリトライ...`);
        
        await activateKeepAwakeAsync();
        await delay(totalWait);
        waitTime *= 2; 
      } else {
        addLog(`🚫 リトライを断念しました: ${err.message}`);
        console.error("文字起こし最終エラー:", err);
        throw err;
      }
    }
  }
  return "";
}

async function generateFinalMinutes(allText: string, audioFileId?: string | null) {
  const maxRetries = 5;
  let waitTime = 30000; 

  addLog(`📝 議事録生成リクエスト開始 (文字数: ${allText.length})`); // 💡 ログ追加

  for (let i = 0; i < maxRetries; i++) {
    try {
      setLoading(true);
      setStatus(`議事録を生成中... (${i + 1}/${maxRetries}回目)`);
      
      const d = new Date();
      const meetingDate = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes().toString().padStart(2, '0')}分`;

      const promptText = `以下のテキストは長時間の会議を分割して文字起こしした全データです。冒頭から最後の1秒まで全て解析し、日本語で議事録を作成してください。\n\n【重要】出力はプレーンテキストのみとし、「#」や「*」などのMarkdown記号は一切使用しないでください。見出しは【】で囲み、箇条書きには「・」や数字を使用してください。\n\n【会議の全文字起こしデータ】\n${allText}`;

      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'generateMinutes',
          promptText: promptText 
        })
      });

      const data = await response.json();

      if (data.error) {
        addLog(`❌ 議事録生成時にGASエラー: ${data.error}`); // 💡 ログ追加
        throw new Error(data.error);
      }

      addLog(`✅ 議事録完成！`); // 💡 ログ追加
      const resultText = data.candidates[0].content.parts[0].text;
      setMinutes(resultText);
      setStatus('議事録完成！クラウドへ保存中...');
      
      const isSuccess = await shareMinutesToPC(resultText);
      await saveToHistory(resultText, isSuccess, audioFileId);
      
      setLoading(false);
      return;

    } catch (err: any) {
      // ✅ 修正：エラーの種類を正しく判定するようにしました
      if (i < maxRetries - 1 && (err.message.includes("503") || err.message.includes("demand") || err.message.includes("timeout") || err.message.includes("Failed to fetch") || err.message.includes("Load failed") || err.message.includes("Network request failed"))) {
        
        // 💡 混雑回避：30秒固定ではなく、数秒のランダムな待ち時間を加える（Jitter）
        const jitter = Math.random() * 10000; 
        const totalWait = waitTime + jitter;

        setStatus(`通信エラー検知。${Math.round(totalWait / 1000)}秒後にリトライ...`);
        addLog(`🔄 混雑回避のためリトライ開始 (${i + 1}/${maxRetries})`); 
        
        await activateKeepAwakeAsync();
        await delay(totalWait); // 💡 ランダムな待ち時間で待機
        waitTime *= 2;
      } else {
        addLog(`🚫 議事録生成を断念しました: ${err.message}`);
        console.error("議事録生成最終エラー:", err);
        if (allText) {
          await saveToHistory("(再試行しましたが失敗しました)\n" + allText, false, audioFileId);
        }
        setStatus('解析失敗');
        setLoading(false);
        break;
      }
    }
  }
}

async function shareMinutesToPC(finalMinutesText: string): Promise<boolean> {
    try {
      const currentToken = await getValidToken(); // 💡 追加
      if (!currentToken || !tvnFolderId) {
        throw new Error("ログインしていないか、フォルダが見つかりません");
      }

      setStatus('Google Driveへ議事録を保存中...');
      const formattedDate = getFormattedDate();

      const metadata = {
        name: `議事録_${formattedDate}`, 
        mimeType: 'application/vnd.google-apps.document', 
        parents: [tvnFolderId]
      };

      const fileData = new Blob([finalMinutesText], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      formData.append('file', fileData);

      const textResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` }, // 💡 変更
        body: formData
      });

      if (!textResponse.ok) throw new Error("議事録の保存に失敗しました");

      setStatus('Google Driveへ音声データを保存中...');
      
      for (let i = 0; i < audioFilesRef.current.length; i++) {
        const fileUri = audioFilesRef.current[i];
        const partSuffix = audioFilesRef.current.length > 1 ? `_part${i + 1}` : '';
        
        const audioBlob = await fetch(fileUri).then(r => r.blob());
        const audioMetadata = {
          name: `音声データ_${formattedDate}${partSuffix}.webm`,
          parents: [tvnFolderId]
        };

        const audioFormData = new FormData();
        audioFormData.append('metadata', new Blob([JSON.stringify(audioMetadata)], { type: 'application/json' }));
        audioFormData.append('file', audioBlob);

        const audioResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` }, // 💡 変更
          body: audioFormData
        });

        if (!audioResponse.ok) throw new Error(`音声パート${i+1}の保存に失敗しました`);
      }

      Alert.alert("保存成功！", "Google Driveの「TVN」フォルダに議事録と音声が保存されました。");
      setStatus('✨ 全ての処理が完了しました！');
      return true;

    } catch (err: any) {
      console.error("保存エラー:", err);
      Alert.alert("保存エラー", `詳細: ${err.message}`);
      setStatus('転送失敗');
      return false;
    }
  }

async function retryUpload(item: HistoryItem) {
    setHistoryModalVisible(false);
    setLoading(true);
    
    try {
      // 💡 追加：(エラー中断)が含まれる場合はドライブの音声ファイルから全編やり直す
      if (item.minutes.includes("(エラー中断)")) {
        setStatus('音声ファイルから全編再解析中...');
        const response = await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'reTranscribeFromDrive', fileId: item.audioFileId }),
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const fullText = data.candidates[0].content.parts[0].text;
        await generateFinalMinutes(fullText, item.audioFileId);
        return; // ここで完了
      }

      // 💡 増殖を防ぐため、古い失敗履歴を一度消してからやり直す
      const saved = await AsyncStorage.getItem('meeting_history');
      const currentHistory: HistoryItem[] = saved ? JSON.parse(saved) : [];
      const filteredHistory = currentHistory.filter((h: HistoryItem) => h.id !== item.id);
      setHistory(filteredHistory);
      await AsyncStorage.setItem('meeting_history', JSON.stringify(filteredHistory));

      if (item.minutes.includes("(Googleサーバー混雑により中断")) {
        // 音声ファイルから文字起こしを再試行
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${item.audioFileId}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const blob = await response.blob();
        const text = await transcribeAudio(blob);
        if (text) await generateFinalMinutes(text, item.audioFileId);

      } else if (item.minutes.includes("(未解析の生データ)") || item.minutes.includes("(再試行しましたが失敗しました)")) {
        const rawText = item.minutes.replace("(未解析の生データ)\n", "").replace("(再試行しましたが失敗しました)\n", "");
        await generateFinalMinutes(rawText, item.audioFileId);

      } else {
        const success = await shareMinutesToPC(item.minutes);
        await saveToHistory(item.minutes, success, item.audioFileId);
      }
    } catch (e: any) {
      console.error(e);
      setStatus('再送エラー');
      Alert.alert("エラー", "再試行に失敗しました。");
      await saveToHistory(item.minutes, false, item.audioFileId);
    }
    setLoading(false);
  }
  // 💡 修正2：削除時も同様に「最新のデータ」から削除する
  async function deleteHistoryItem(id: string) {
    const executeDelete = async () => {
      const saved = await AsyncStorage.getItem('meeting_history');
      const currentHistory: HistoryItem[] = saved ? JSON.parse(saved) : [];
      
      const newHistory = currentHistory.filter((item: HistoryItem) => item.id !== id);
      setHistory(newHistory);
      await AsyncStorage.setItem('meeting_history', JSON.stringify(newHistory));
    };

    if (Platform.OS === 'web') {
      if (window.confirm("この履歴を削除してもよろしいですか？")) {
        await executeDelete();
      }
    } else {
      Alert.alert("履歴の削除", "この履歴を削除してもよろしいですか？", [
        { text: "キャンセル", style: "cancel" },
        { text: "削除", style: "destructive", onPress: executeDelete }
      ]);
    }
  }

  return (
    <View style={styles.mainWrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* ヘッダー部分（新しいデザイン） */}
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>東宝ボイスノート</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* 💡 既存のログアウトボタンと履歴ボタンを削除し、歯車アイコンを追加 */}
            <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.headerMenuButton}>
              <Ionicons name="settings-outline" size={28} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ▼▼▼ 条件分岐：ログインしていない時の画面 ▼▼▼ */}
        {!accessToken ? (
          <View style={styles.loginContainer}>
            {/* 💡 追加: ログイン画面でも今のステータスが見えるようにする */}
            <View style={styles.statusBadge}>
               {/* 💡 追加：フォルダへ直行するボタン */}
                {tvnFolderId && (
                  <TouchableOpacity 
                    onPress={() => window.open(`https://drive.google.com/drive/folders/${tvnFolderId}`, '_blank')}
                    style={{ backgroundColor: '#fff', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#28A745', marginBottom: 20, flexDirection: 'row', alignItems: 'center' }}
                  >
                    <Ionicons name="folder-open-outline" size={20} color="#28A745" />
                    <Text style={{ color: '#28A745', marginLeft: 8, fontWeight: 'bold' }}>作成されたTVNフォルダを確認する</Text>
                  </TouchableOpacity>
                )}
              <Text style={styles.statusText}>{status}</Text>
            </View>
              <Text style={styles.loginDescription}>
                東宝ボイスノートを利用するには、会社のGoogleアカウントでログインしてください。
              </Text>
              <TouchableOpacity 
                style={styles.loginButton} 
                disabled={!request} 
                onPress={async () => {
                  // 💡 修正：一時パスワードのメモ機能（localStorage/AsyncStorageの保存）を丸ごと削除！

                  if (Platform.OS === 'web' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                    // スマホの場合は今の画面のまま直接Googleへ行く
                    if (request?.url) {
                      window.location.href = request.url;
                    }
                  } else {
                    // PCの場合は今まで通り
                    promptAsync();
                  }
                }}
              >
                <Ionicons name="logo-google" size={24} color="white" />
                <Text style={styles.loginButtonText}>Googleでログイン</Text>
              </TouchableOpacity>
          </View>
        ) : (
          // ▼▼▼ 条件分岐：ログイン成功後の画面（今まで通り） ▼▼▼
          <>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{status}</Text>
            </View>

            {/* 録音タイマー */}
            {recording && (
              <View style={styles.timerContainer}>
                <Text style={styles.timerText}>{getFormattedTime()}</Text>
              </View>
            )}

            {loading && <ActivityIndicator size="large" color="#007AFF" style={{marginVertical: 20}} />}

            {/* 議事録結果 */}
            {minutes ? (
              <View style={{ width: '100%', marginBottom: 20 }}>
                <View style={styles.resultContainer}>
                  <Text style={styles.resultTitle}>📝 議事録結果</Text>
                  <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled={true}>
                    <Text style={styles.minutesText}>{minutes}</Text>
                  </ScrollView>
                </View>
              </View>
            ) : null}

            {/* 下部余白 */}
            <View style={{ height: 120 }} />
          </>
        )}
      </ScrollView>

      {/* 録音ボタン（ログインしている時だけ表示） */}
      {accessToken && (
        <View style={styles.bottomButtonContainer}>
          <View style={styles.pulseWrapper}>
            <TouchableOpacity 
              style={[styles.button, recording ? styles.stopButton : styles.startButton]} 
              onPress={() => (recording ? stopRecording() : startRecording())}
              activeOpacity={0.8}
              disabled={loading} 
            >
              <View style={styles.buttonInner}>
                <Ionicons name={recording ? 'stop' : 'mic'} size={28} color="white" />
                <Text style={styles.buttonText}>{recording ? '録音を止める' : '録音を開始'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 履歴画面のモーダル（今まで通り） */}
      <Modal 
        visible={isHistoryModalVisible} 
        animationType="slide" 
        presentationStyle="pageSheet" 
        onRequestClose={() => setHistoryModalVisible(false)} 
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📂 過去の履歴</Text>
            <TouchableOpacity onPress={() => setHistoryModalVisible(false)} style={{padding: 5}}>
              <Ionicons name="close" size={32} color="#333" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {history.length === 0 && <Text style={{color: '#888', marginTop: 10, textAlign: 'center'}}>履歴はまだありません</Text>}
            
            {history.map((item) => (
              <View key={item.id} style={styles.historyItem}>
                <TouchableOpacity 
                  style={{flex: 1, paddingRight: 10}}
                  onPress={() => Alert.alert("議事録の内容", item.minutes)}
                >
                  <Text style={styles.historyDate}>{item.date}</Text>
                  <Text numberOfLines={1} style={styles.historySnippet}>{item.minutes}</Text>
                </TouchableOpacity>

                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  {item.status === 'failed' ? (
                    <TouchableOpacity onPress={() => retryUpload(item)} style={styles.retryButton}>
                      <Text style={styles.retryText}>再送</Text>
                    </TouchableOpacity>
                  ) : (
                    <Ionicons name="cloud-done" size={28} color="#28A745" />
                  )}

                  <TouchableOpacity onPress={() => deleteHistoryItem(item.id)} style={{marginLeft: 15}}>
                    <Ionicons name="trash-outline" size={24} color="#DC3545" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
      {/* 録音ボタンなどの既存コードがここにあるはずです */}
      {/* 💡 ここに貼り付けます！ ▼▼▼ */}
      <Modal
        visible={isMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuContent}>
            
            {/* ① 履歴ボタン */}
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setHistoryModalVisible(true); }}>
              <Ionicons name="time-outline" size={20} color="#1A1A1A" style={styles.menuIcon} />
              <Text style={styles.menuText}>履歴</Text>
            </TouchableOpacity>
            
            {/* ② 動作ログ（虫マーク）ボタン */}
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setShowLogModal(true); }}>
              <Ionicons name="bug-outline" size={20} color="#1A1A1A" style={styles.menuIcon} />
              <Text style={styles.menuText}>動作ログ</Text>
            </TouchableOpacity>

            {/* ③ ログアウトボタン */}
            {accessToken && (
              <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={() => { setMenuVisible(false); handleLogout(); }}>
                <Ionicons name="log-out-outline" size={20} color="#DC3545" style={styles.menuIcon} />
                <Text style={[styles.menuText, styles.logoutText]}>ログアウト</Text>
              </TouchableOpacity>
            )}
            
          </View>
        </TouchableOpacity>
      </Modal>
      {/* 💡 ここまで貼り付ける ▲▲▲ */}

      {/* ログ表示用の真っ黒な画面（モーダル） */}
      <Modal visible={showLogModal} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: 'white', fontSize: 22, fontWeight: 'bold' }}>動作ログ (Debug)</Text>
            <TouchableOpacity onPress={() => setShowLogModal(false)}>
              <Ionicons name="close-circle" size={35} color="#FF3B30" />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={{ flex: 1, paddingHorizontal: 20 }}>
            {logs.length === 0 ? (
              <Text style={{ color: '#666', textAlign: 'center', marginTop: 50 }}>ログはありません</Text>
            ) : (
              logs.map((log, i) => (
                <Text key={i} style={{ 
                  color: log.includes('❌') || log.includes('🚫') ? '#FF453A' : log.includes('✅') ? '#32D74B' : '#E5E5EA', 
                  fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', 
                  marginBottom: 6, 
                  fontSize: 11,
                  borderBottomWidth: 0.5,
                  borderBottomColor: '#333',
                  paddingBottom: 4
                }}>
                  {log}
                </Text>
              ))
            )}
          </ScrollView>

          <TouchableOpacity 
            onPress={() => setLogs([])} 
            style={{ padding: 20, backgroundColor: '#1C1C1E', alignItems: 'center' }}
          >
            <Text style={{ color: '#0A84FF', fontSize: 16 }}>ログをすべて消去</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      {/* --- 💡 ここまでを貼り付け --- */}

    </View> // 👈 これが一番外側の View の閉じタグです
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: '#F8F9FA' },
  container: { flexGrow: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 150 },
  headerContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 15 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end' },
  menuContent: { backgroundColor: 'white', borderRadius: 10, padding: 10, marginTop: 90, marginRight: 20, width: 200, elevation: 5 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#EEE' },
  menuIcon: { marginRight: 15 },
  menuText: { fontSize: 16, color: '#1A1A1A' },
  logoutItem: { borderBottomWidth: 0 },
  logoutText: { color: '#DC3545', fontWeight: 'bold' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#1A1A1A' },
  headerMenuButton: { padding: 5, marginRight: -5 },
  statusBadge: { backgroundColor: '#E9ECEF', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 20, marginBottom: 20 },
  statusText: { fontSize: 14, color: '#495057', fontWeight: '600' },
  timerContainer: { marginBottom: 30, alignItems: 'center', justifyContent: 'center' },
  timerText: { fontSize: 56, fontWeight: '300', color: '#1A1A1A' }, 
  resultContainer: { padding: 20, backgroundColor: 'white', borderRadius: 15, width: '100%', borderLeftWidth: 5, borderLeftColor: '#28A745' },
  resultTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#1A1A1A' },
  minutesText: { fontSize: 16, lineHeight: 26, color: '#343A40' },
  historyItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginTop: 10, elevation: 2 },
  historyDate: { fontSize: 12, color: '#6C757D', marginBottom: 4 },
  historySnippet: { fontSize: 14, color: '#212529' },
  retryButton: { backgroundColor: '#FF3B30', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  retryText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
  modalContainer: { flex: 1, backgroundColor: '#F8F9FA', paddingTop: 50, paddingHorizontal: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#DEE2E6', paddingBottom: 15, marginBottom: 15 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A1A1A' },
  bottomButtonContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 40, paddingHorizontal: 20 },
  pulseWrapper: { width: '100%', alignItems: 'center' },
  button: { width: '90%', height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  startButton: { backgroundColor: '#007AFF' },
  stopButton: { backgroundColor: '#FF3B30' }, 
  buttonInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: 'white', fontSize: 20, fontWeight: 'bold', marginLeft: 12 },
  loginContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 80, paddingHorizontal: 20 },
  loginDescription: { fontSize: 16, color: '#495057', textAlign: 'center', marginBottom: 40, lineHeight: 24 },
  loginButton: { flexDirection: 'row', backgroundColor: '#4285F4', paddingVertical: 15, paddingHorizontal: 30, borderRadius: 30, alignItems: 'center' },
  loginButtonText: { color: 'white', fontSize: 18, fontWeight: 'bold', marginLeft: 12 },
});