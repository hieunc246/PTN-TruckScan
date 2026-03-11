import { useState, useRef, useEffect, useCallback, MouseEvent, FormEvent } from 'react';
import { Camera, MapPin, Clock, Truck, Ship, History, X, CheckCircle2, AlertCircle, Loader2, CameraIcon, RefreshCw, Printer, Box, QrCode, Flashlight, Upload, Eye, FileDown, Smartphone, Cloud, Settings, Trash2, ChevronDown, Search, ChevronLeft, ChevronRight, Lock, User, LogIn, LogOut } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { QRCodeSVG } from 'qrcode.react';

// --- Types ---

interface CaptureRecord {
  id: string;
  imageUrl: string;
  vehicleType: 'truck' | 'ship' | 'unknown';
  idNumber: string;
  customerCode?: string;
  timestamp: string;
  location: {
    lat: number;
    lng: number;
    address: string;
  };
  confidence: number;
  volume?: string;
  productType?: 'Cát' | 'Đất';
}

interface GeminiResult {
  vehicleType: 'truck' | 'ship' | 'unknown';
  locationName: string;
  confidence: number;
}

// --- Constants ---

const STORAGE_KEY = 'logitrack_history';
const COMPANY_INFO = {
  name: "Công Ty TNHH TM-DV-XD Phương Thảo Nguyên",
  taxId: "0303122455",
  address: "192/18 Nguyễn Thái Bình, P. Bảy Hiền, TP. Hồ Chí Minh"
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('isLoggedIn') === 'true';
  });
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showQrContent, setShowQrContent] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [history, setHistory] = useState<CaptureRecord[]>([]);
  const [currentResult, setCurrentResult] = useState<CaptureRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idNumberInput, setIdNumberInput] = useState("");
  const [customerCodeInput, setCustomerCodeInput] = useState("");
  const [volumeInput, setVolumeInput] = useState("");
  const [productType, setProductType] = useState<'Cát' | 'Đất'>('Cát');
  const [showPrintView, setShowPrintView] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isThermalMode, setIsThermalMode] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [isModified, setIsModified] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<'all' | 'id' | 'idNumber' | 'customerCode'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingToSheet, setIsSavingToSheet] = useState(false);
  const [isDeletingFromSheet, setIsDeletingFromSheet] = useState(false);
  const [editForm, setEditForm] = useState<CaptureRecord | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);

  const deleteFromGoogleSheet = async (id: string): Promise<boolean> => {
    setIsDeletingFromSheet(true);
    try {
      const response = await fetch('/api/delete-from-sheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        // If not found in sheet, we still consider it a success for the UI
        if (response.status === 404) return true;
        throw new Error(errorData.error || 'Lỗi khi xóa khỏi Google Sheets');
      }
      
      return true;
    } catch (err: any) {
      console.error('Sheet delete error:', err);
      alert(`Lỗi khi xóa trên Google Sheet: ${err.message}`);
      return false;
    } finally {
      setIsDeletingFromSheet(false);
    }
  };

  const saveToGoogleSheet = async (record: CaptureRecord): Promise<boolean> => {
    setIsSavingToSheet(true);
    try {
      const response = await fetch('/api/save-to-sheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Lỗi khi lưu vào Google Sheets');
      }
      
      const result = await response.json();
      let successMsg = `Đã lưu dữ liệu vào Google Sheet thành công!\n\nFile: ${result.sheetTitle}\nVị trí: ${result.updatedRange || 'D-App'}`;
      if (result.isDefault) {
        successMsg += `\n\nLưu ý: Bạn đang sử dụng Sheet mặc định. Để dùng Sheet riêng, hãy cấu hình GOOGLE_SHEETS_ID trong Secrets.`;
      }
      alert(successMsg);
      return true;
    } catch (err: any) {
      console.error('Sheet save error:', err);
      alert(`Lỗi: ${err.message}. Vui lòng kiểm tra cấu hình GOOGLE_SERVICE_ACCOUNT_KEY.`);
      return false;
    } finally {
      setIsSavingToSheet(false);
    }
  };
  const [locationName, setLocationName] = useState<string>("Đang xác định vị trí...");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const [lastLocationCall, setLastLocationCall] = useState<{ lat: number; lng: number; time: number } | null>(null);

  // --- Geolocation ---
  const fetchLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Trình duyệt không hỗ trợ định vị.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setLocation({ lat, lng });
          
          // Optimization: Only call Gemini if moved significantly or 5 mins passed
          const now = Date.now();
          if (lastLocationCall) {
            const dist = Math.sqrt(Math.pow(lat - lastLocationCall.lat, 2) + Math.pow(lng - lastLocationCall.lng, 2));
            if (dist < 0.001 && (now - lastLocationCall.time) < 300000) {
              return; // Skip API call
            }
          }

          if (process.env.GEMINI_API_KEY) {
            try {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: `Loc: ${lat}, ${lng}. Shortest VN name (e.g. Cảng Cát Lái). Text only.`,
              });
              setLocationName(response.text || "Vị trí hiện tại");
              setLastLocationCall({ lat, lng, time: now });
            } catch (e: any) {
              console.error("Reverse geocode error", e);
              if (e.message?.includes('429')) {
                // Silently fail to coordinates if rate limited
                setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
              } else {
                setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
              }
            }
          } else {
            setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          }
        } catch (err) {
          console.error("Geolocation success callback error", err);
        }
      },
      (err) => {
        console.error("Location error", err);
        setError("Không thể lấy vị trí. Vui lòng bật GPS.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [lastLocationCall]);

  // --- Clock for Overlay ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Initialization ---
  useEffect(() => {
    const loadHistory = async () => {
      try {
        // 1. Try to load from LocalStorage first for immediate UI
        const savedHistory = localStorage.getItem(STORAGE_KEY);
        if (savedHistory) {
          setHistory(JSON.parse(savedHistory));
        }

        // 2. Then fetch from Google Sheets to synchronize
        if (isLoggedIn) {
          const response = await fetch('/api/get-history');
          if (response.ok) {
            const data = await response.json();
            if (data.history && data.history.length > 0) {
              // Merge or replace? Replacing is cleaner for "synchronization"
              setHistory(data.history);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(data.history.slice(0, 20)));
            }
          }
        }
      } catch (e) {
        console.error("Failed to load history", e);
        // Don't clear localStorage on network error
      }
    };

    loadHistory();
    // Auto-start camera
    setIsCameraActive(true);
  }, [isLoggedIn]);

  // --- Error Auto-clear ---
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    if (isCameraActive && !capturedImage && !isProcessing) {
      const initCamera = async () => {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setError("Trình duyệt của bạn không hỗ trợ truy cập camera hoặc đang chạy trong môi trường không an toàn (HTTP).");
            setIsCameraActive(false);
            return;
          }

          // Stop any existing tracks before starting new ones
          if (videoRef.current && videoRef.current.srcObject) {
            const oldStream = videoRef.current.srcObject as MediaStream;
            oldStream.getTracks().forEach(track => track.stop());
          }

          try {
            // Try with high quality first, using 'ideal' for better compatibility
            stream = await navigator.mediaDevices.getUserMedia({
              video: { 
                facingMode: { ideal: facingMode },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              },
              audio: false,
            });
          } catch (err: any) {
            console.warn("High-quality camera failed, trying basic...", err);
            try {
              // Fallback 1: Basic video with facingMode ideal
              stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: facingMode } },
                audio: false,
              });
            } catch (fallbackErr: any) {
              console.warn("Basic camera with facingMode failed, trying any camera...", fallbackErr);
              try {
                // Fallback 2: Any available camera (crucial for desktops/laptops)
                stream = await navigator.mediaDevices.getUserMedia({
                  video: true,
                  audio: false,
                });
              } catch (finalErr: any) {
                // Check if any video devices even exist
                try {
                  const devices = await navigator.mediaDevices.enumerateDevices();
                  const hasVideo = devices.some(d => d.kind === 'videoinput');
                  if (!hasVideo) {
                    throw new Error("Không tìm thấy thiết bị camera nào được kết nối với hệ thống. Nếu bạn đang dùng máy tính bàn, hãy đảm bảo đã cắm webcam.");
                  }
                } catch (enumErr) {
                  // If enumerateDevices fails, just throw the original error
                }
                throw finalErr; // Re-throw to be caught by the outer catch
              }
            }
          }
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          fetchLocation();
        } catch (err: any) {
          console.error("Camera access error", err);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError("TRUY CẬP BỊ TỪ CHỐI: Vui lòng nhấn vào biểu tượng ổ khóa trên thanh địa chỉ trình duyệt, chọn 'Cho phép' Camera và tải lại trang.");
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.message?.includes('Requested device not found')) {
            setError("KHÔNG TÌM THẤY CAMERA: Thiết bị của bạn dường như không có camera hoặc camera đã bị ngắt kết nối. Nếu bạn đang dùng máy tính bàn, hãy đảm bảo đã cắm webcam.");
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.message?.includes('could not start')) {
            setError("CAMERA ĐANG BẬN: Một ứng dụng khác đang sử dụng camera (như Zoom, Teams, Zalo). Vui lòng đóng các ứng dụng đó và thử lại.");
          } else if (err.name === 'OverconstrainedError') {
            setError("LỖI CẤU HÌNH: Camera của bạn không hỗ trợ độ phân giải yêu cầu. Đang thử lại với cấu hình thấp hơn...");
            // This case is already partially handled by fallbacks, but we can try one last time with absolute minimums
            try {
              stream = await navigator.mediaDevices.getUserMedia({ video: true });
              if (videoRef.current) videoRef.current.srcObject = stream;
              return;
            } catch (e) {
              setError("KHÔNG THỂ KHỞI TẠO CAMERA: " + (e as Error).message);
            }
          } else {
            setError("LỖI CAMERA: " + (err.message || "Không xác định") + ". Vui lòng thử tải lại trang hoặc kiểm tra quyền truy cập camera.");
          }
          setIsCameraActive(false);
        }
      };
      initCamera();
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraActive, facingMode, capturedImage, isProcessing]);

  useEffect(() => {
    if (history.length > 0) {
      try {
        // Limit history to 20 items to prevent LocalStorage QuotaExceededError
        const limitedHistory = history.slice(0, 20);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(limitedHistory));
      } catch (e) {
        console.error("Failed to save history", e);
        // If quota exceeded, try saving even fewer items
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 5)));
        } catch (e2) {
          // If still failing, don't crash the app
        }
      }
    }
  }, [history]);

  // --- Camera Logic ---

  const startCamera = async () => {
    setIsCameraActive(true);
    setError(null);
    setVolumeInput("");
    setProductType("Cát");
    setCapturedImage(null);
    setCurrentResult(null);
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const toggleFlash = async () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      try {
        const capabilities = track.getCapabilities() as any;
        if (capabilities.torch) {
          await track.applyConstraints({
            advanced: [{ torch: !isFlashOn }]
          } as any);
        }
        setIsFlashOn(!isFlashOn);
      } catch (e) {
        console.error("Flash error", e);
        setIsFlashOn(!isFlashOn);
      }
    } else {
      setIsFlashOn(!isFlashOn);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const canvas = canvasRef.current;
      
      // Resize to a reasonable max dimension (1024px) to save memory and storage
      const maxDim = 1024;
      let width = video.videoWidth;
      let height = video.videoHeight;
      
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (maxDim / width) * height;
          width = maxDim;
        } else {
          width = (maxDim / height) * width;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        // Use higher quality (0.8) to improve resolution
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        stopCamera();
        setCapturedImage(dataUrl);
        processImage(dataUrl);
      }
    }
  };

  // --- AI Processing ---

  const generateTicketId = () => {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    
    let ticketId = "";
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 100) {
      const randomLetter = letters[Math.floor(Math.random() * letters.length)];
      const randomDigits = Math.floor(1000 + Math.random() * 9000).toString();
      ticketId = `${yy}${randomLetter}${mm}${dd}${randomDigits}`;
      
      // Check if this ID already exists in history
      const exists = history.some(record => record.id === ticketId);
      if (!exists) {
        isUnique = true;
      }
      attempts++;
    }
    
    return ticketId;
  };

  const processImage = async (base64Image: string) => {
    // Immediately stop camera and show the form
    if (isCameraActive) stopCamera();
    
    const initialRecord: CaptureRecord = {
      id: generateTicketId(),
      imageUrl: base64Image,
      vehicleType: 'truck',
      idNumber: '',
      customerCode: '',
      timestamp: new Date().toISOString(),
      location: {
        lat: location?.lat || 0,
        lng: location?.lng || 0,
        address: locationName || "Đang xác định vị trí...",
      },
      confidence: 0,
      productType: productType,
      volume: volumeInput,
    };

    setCurrentResult(initialRecord);
    setIdNumberInput("");
    setCustomerCodeInput("");
    setIsNewRecord(true);
    setIsModified(false);
    setHistory(prev => [initialRecord, ...prev]);
    setCapturedImage(null);
    setIsProcessing(true);
    setError(null);

    const callAI = async (retryCount = 0): Promise<GeminiResult> => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const prompt = `Reverse geocode: ${location?.lat}, ${location?.lng}. 
        JSON: {"locationName": "string"}`;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                locationName: { type: Type.STRING },
              },
              required: ['locationName'],
            },
          },
        });

        const text = response.text || '{}';
        const data = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        return {
          vehicleType: 'truck',
          locationName: data.locationName || locationName || "Vị trí không xác định",
          confidence: 1.0
        };
      } catch (err: any) {
        if (err.message?.includes('429') && retryCount < 2) {
          await new Promise(r => setTimeout(r, 2000 * (retryCount + 1)));
          return callAI(retryCount + 1);
        }
        throw err;
      }
    };

    try {
      if (!process.env.GEMINI_API_KEY) {
        setIsProcessing(false);
        return;
      }

      const resultData = await callAI();

      setCurrentResult(prev => {
        if (!prev || prev.id !== initialRecord.id) return prev;
        const updated = {
          ...prev,
          vehicleType: resultData.vehicleType && resultData.vehicleType !== 'unknown' ? resultData.vehicleType : prev.vehicleType,
          location: {
            ...prev.location,
            address: resultData.locationName || prev.location.address,
          },
          confidence: resultData.confidence || prev.confidence,
        };
        // Update history as well
        setHistory(hPrev => hPrev.map(r => r.id === initialRecord.id ? updated : r));
        return updated;
      });
    } catch (err: any) {
      console.error("AI Processing error", err);
      // Silently fail or show a subtle hint since the user is already at the form
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Debug Config ---
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [isDebugLoading, setIsDebugLoading] = useState(false);

  const checkConfig = async () => {
    setIsDebugLoading(true);
    try {
      const res = await fetch('/api/check-config');
      const data = await res.json();
      setDebugInfo(data);
    } catch (e) {
      console.error("Failed to check config", e);
      setError("Không thể kiểm tra cấu hình hệ thống.");
    } finally {
      setIsDebugLoading(false);
    }
  };

  const handleFileUpload = (e: import('react').ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        
        // Resize uploaded image before processing
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1024;
          let width = img.width;
          let height = img.height;
          
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = (maxDim / width) * height;
              width = maxDim;
            } else {
              width = (maxDim / height) * width;
              height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            setCapturedImage(resizedDataUrl);
            processImage(resizedDataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpdateIdNumber = (val: string) => {
    setIdNumberInput(val);
    setIsModified(true);
    if (currentResult) {
      setCurrentResult({ ...currentResult, idNumber: val });
      setHistory(prev => prev.map(r => r.id === currentResult.id ? { ...r, idNumber: val } : r));
    }
  };

  const handleUpdateCustomerCode = (val: string) => {
    setCustomerCodeInput(val);
    setIsModified(true);
    if (currentResult) {
      setCurrentResult({ ...currentResult, customerCode: val });
      setHistory(prev => prev.map(r => r.id === currentResult.id ? { ...r, customerCode: val } : r));
    }
  };

  const handleUpdateVolume = (val: string) => {
    setVolumeInput(val);
    setIsModified(true);
    if (currentResult) {
      const updated = { ...currentResult, volume: val };
      setCurrentResult(updated);
      setHistory(prev => prev.map(h => h.id === currentResult.id ? updated : h));
    }
  };

  // Fetch previous volume for vehicle
  useEffect(() => {
    if (!idNumberInput || idNumberInput.length < 3) return;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/get-vehicle-volume/${encodeURIComponent(idNumberInput)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.volume && !volumeInput) {
            handleUpdateVolume(data.volume);
          }
        }
      } catch (err) {
        console.error("Error fetching vehicle volume:", err);
      }
    }, 800); // Debounce 800ms

    return () => clearTimeout(timer);
  }, [idNumberInput]);

  const handleUpdateProductType = (val: 'Cát' | 'Đất') => {
    setProductType(val);
    setIsModified(true);
    if (currentResult) {
      const updated = { ...currentResult, productType: val };
      setCurrentResult(updated);
      setHistory(prev => prev.map(h => h.id === currentResult.id ? updated : h));
    }
  };

  const handleUpdateVehicleType = (val: 'truck' | 'ship') => {
    setIsModified(true);
    if (currentResult) {
      const updated = { ...currentResult, vehicleType: val };
      setCurrentResult(updated);
      setHistory(prev => prev.map(h => h.id === currentResult.id ? updated : h));
    }
  };

  const handleVideoClick = (e: MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setFocusPoint({ x, y });
    
    // Hide focus point after 1.5s
    setTimeout(() => setFocusPoint(null), 1500);
  };

  const resetCapture = () => {
    setCapturedImage(null);
    setCurrentResult(null);
    setError(null);
    setVolumeInput("");
    setIdNumberInput("");
    setCustomerCodeInput("");
    setShowQrContent(false);
    setIsNewRecord(false);
    setIsModified(false);
    startCamera();
  };

  const handleOpenPrint = async () => {
    const volume = parseFloat(volumeInput);
    if (!idNumberInput || idNumberInput === '---') {
      setError("Vui lòng nhập biển số / số hiệu");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!volumeInput || isNaN(volume) || volume <= 0) {
      setError("Vui lòng nhập khối lượng");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (currentResult) {
      // Only save if it's a new record OR it has been modified
      if (isNewRecord || isModified) {
        const success = await saveToGoogleSheet(currentResult);
        if (!success) {
          return; // Stop if saving to sheet fails
        }
        // After successful save, it's no longer "new" or "modified" relative to the sheet
        setIsNewRecord(false);
        setIsModified(false);
      }
    }
    
    setShowPrintView(true);
  };

  const handlePrint = async () => {
    const printElement = document.getElementById('printable-ticket');
    if (!printElement) return;

    const toast = document.createElement('div');
    toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 text-white px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-3 border border-white/10';
    toast.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang chuẩn bị bản in...';
    document.body.appendChild(toast);

    try {
      // Small delay to ensure styles are applied
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create a high-quality image of the ticket
      const canvas = await html2canvas(printElement, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: printElement.scrollWidth,
        windowHeight: printElement.scrollHeight,
        onclone: (clonedDoc) => {
          const ticket = clonedDoc.getElementById('printable-ticket');
          if (ticket) {
            ticket.style.fontFamily = 'sans-serif';
          }
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      
      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.innerHTML = '⚠️ Trình duyệt đã chặn cửa sổ bật lên. Vui lòng cho phép bật lên để in.';
        setTimeout(() => toast.remove(), 5000);
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>In Phiếu Cân - ${idNumberInput}</title>
            <style>
              body { margin: 0; display: flex; justify-content: center; align-items: flex-start; background: white; }
              img { width: 100%; max-width: ${isThermalMode ? '80mm' : '148mm'}; height: auto; }
              @page { margin: 0; size: auto; }
              @media print {
                body { margin: 0; }
                img { width: 100%; }
              }
            </style>
          </head>
          <body>
            <img src="${imgData}" onload="window.print(); window.onafterprint = function() { window.close(); };" />
            <script>
              // Fallback for mobile browsers that don't support onafterprint
              setTimeout(function() {
                // We don't close automatically on mobile to let user see the print dialog
              }, 2000);
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      
      toast.remove();
    } catch (err) {
      console.error('Print Error:', err);
      toast.innerHTML = '❌ Lỗi khi chuẩn bị bản in. Vui lòng thử lại.';
      setTimeout(() => toast.remove(), 3000);
      
      // Fallback to standard print
      window.print();
    }
  };

  const handleDownloadPDF = async () => {
    const printElement = document.getElementById('printable-ticket');
    if (!printElement) return;

    const toast = document.createElement('div');
    toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 text-white px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-3 border border-white/10';
    toast.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Đang tạo file PDF...';
    document.body.appendChild(toast);

    try {
      // Small delay to ensure styles are applied
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(printElement, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: printElement.scrollWidth,
        windowHeight: printElement.scrollHeight,
        onclone: (clonedDoc) => {
          const ticket = clonedDoc.getElementById('printable-ticket');
          if (ticket) {
            ticket.style.fontFamily = 'sans-serif';
          }
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: isThermalMode ? [88, (canvas.height * 88) / canvas.width] : 'a5'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
      pdf.save(`Phieu_Can_${idNumberInput}_${new Date().getTime()}.pdf`);
      
      toast.innerHTML = '✅ Đã tải xuống file PDF!';
      setTimeout(() => toast.remove(), 2000);
    } catch (err) {
      console.error('PDF Error:', err);
      toast.innerHTML = '❌ Lỗi khi tạo PDF. Vui lòng thử lại.';
      setTimeout(() => toast.remove(), 3000);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loginId, password: loginPassword }),
      });

      const data = await response.json();

      if (response.ok) {
        setIsLoggedIn(true);
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userId', data.userId);
      } else {
        setLoginError(data.error || "Đăng nhập thất bại");
      }
    } catch (err) {
      setLoginError("Lỗi kết nối máy chủ. Vui lòng thử lại.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userId');
    setIsCameraActive(false);
    setCurrentResult(null);
  };

  // --- QR Data Generation ---
  const sanitizeValue = (val: string | undefined | null) => {
    if (!val || val.toLowerCase() === 'unknown' || val.toLowerCase() === 'none' || val === '___' || val === 'N/A' || val === '---') {
      return 'Chưa xác định';
    }
    return val;
  };

  const RenderSanitized = ({ value, className = "" }: { value: string | undefined | null, className?: string }) => {
    const sanitized = sanitizeValue(value);
    if (sanitized === 'Chưa xác định') {
      return <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{sanitized}</span>;
    }
    return <span className={className}>{sanitized}</span>;
  };

  const getQrData = (record: CaptureRecord) => {
    let timeStr = "---";
    try {
      timeStr = new Intl.DateTimeFormat('vi-VN', { 
        dateStyle: 'medium', 
        timeStyle: 'short' 
      }).format(new Date(record.timestamp));
    } catch (e) {
      console.error("Date format error", e);
    }
    
    return `Mã KH: ${sanitizeValue(record.customerCode)}
Số hiệu: ${sanitizeValue(record.idNumber)}
Sản phẩm: ${sanitizeValue(record.productType)}
Khối lượng: ${record.volume || '0'} m³
Thời gian: ${timeStr}`;
  };

  const clearAllHistory = () => {
    if (confirm("Bạn có chắc chắn muốn xóa tất cả dữ liệu lịch sử? Hành động này không thể hoàn tác.")) {
      setHistory([]);
      localStorage.removeItem(STORAGE_KEY);
      setCurrentResult(null);
      setCapturedImage(null);
      setIsCameraActive(true);
    }
  };

  const handleDeleteRecord = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setRecordToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!recordToDelete) return;
    
    const success = await deleteFromGoogleSheet(recordToDelete);
    if (success) {
      setHistory(prev => prev.filter(r => r.id !== recordToDelete));
      if (currentResult?.id === recordToDelete) {
        setCurrentResult(null);
        setIsCameraActive(true);
      }
      setShowDeleteConfirm(false);
      setRecordToDelete(null);
    }
  };

  const handleEditRecord = (record: CaptureRecord, e: MouseEvent) => {
    e.stopPropagation();
    setEditForm({ ...record });
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (editForm) {
      setHistory(prev => prev.map(r => r.id === editForm.id ? editForm : r));
      setIsEditing(false);
      setEditForm(null);
    }
  };

  const isToday = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const filteredHistory = history.filter(record => {
    if (!searchQuery) return isToday(record.timestamp);
    
    const query = searchQuery.toLowerCase();
    let matchesSearch = false;
    
    if (searchType === 'all') {
      matchesSearch = record.idNumber.toLowerCase().includes(query) || 
                      record.id.toLowerCase().includes(query) ||
                      (record.customerCode || "").toLowerCase().includes(query);
    } else if (searchType === 'id') {
      matchesSearch = record.id.toLowerCase().includes(query);
    } else if (searchType === 'idNumber') {
      matchesSearch = record.idNumber.toLowerCase().includes(query);
    } else if (searchType === 'customerCode') {
      matchesSearch = (record.customerCode || "").toLowerCase().includes(query);
    }
    
    return matchesSearch && isToday(record.timestamp);
  });

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);
  const paginatedHistory = filteredHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // --- UI Components ---

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-emerald-500/30 print:bg-white print:text-black">
      {!isLoggedIn ? (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
          {/* Background Decorative Elements */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md relative z-10"
          >
            <div className="bg-zinc-900/50 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 sm:p-10 shadow-2xl">
              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20 rotate-3">
                  <Box className="w-10 h-10 text-white" />
                </div>
                <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic mb-2">Hệ Thống Quản Lý</h1>
                <p className="text-zinc-400 font-bold text-xs uppercase tracking-[0.2em]">Dự án nạo vét Đông Hải</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">ID Tài khoản</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-zinc-500 group-focus-within:text-emerald-500 transition-colors">
                      <User className="w-5 h-5" />
                    </div>
                    <input 
                      type="text"
                      required
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value)}
                      placeholder="Nhập ID của bạn"
                      className="w-full bg-zinc-800/50 border-2 border-zinc-700/50 rounded-2xl py-4 pl-14 pr-5 text-white font-bold focus:border-emerald-500 outline-none transition-all placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">Mật khẩu</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-zinc-500 group-focus-within:text-emerald-500 transition-colors">
                      <Lock className="w-5 h-5" />
                    </div>
                    <input 
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-zinc-800/50 border-2 border-zinc-700/50 rounded-2xl py-4 pl-14 pr-5 text-white font-bold focus:border-emerald-500 outline-none transition-all placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                {loginError && (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                      <p className="text-xs font-bold text-red-400">{loginError}</p>
                    </div>
                    {loginError.includes("403") || loginError.includes("404") || loginError.includes("ID") ? (
                      <button 
                        type="button"
                        onClick={checkConfig}
                        className="text-[10px] text-emerald-400 font-black uppercase tracking-widest hover:text-emerald-300 transition-colors mt-1 flex items-center gap-2"
                      >
                        <Settings className="w-3 h-3" />
                        Kiểm tra cấu hình hệ thống
                      </button>
                    ) : null}
                  </motion.div>
                )}

                <button 
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full h-16 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-700 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  {isLoggingIn ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-5 h-5" />
                      Đăng nhập ngay
                    </>
                  )}
                </button>
              </form>

              <div className="mt-10 pt-8 border-t border-white/5 text-center space-y-4">
                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Phiên bản v2.5 • Bảo mật bởi Google Cloud</p>
                <button 
                  onClick={checkConfig}
                  className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest hover:text-emerald-500 transition-colors flex items-center justify-center gap-2 mx-auto"
                >
                  <RefreshCw className={`w-3 h-3 ${isDebugLoading ? 'animate-spin' : ''}`} />
                  Kiểm tra kết nối Google Sheet
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        <>
          {/* Header - Hidden on Print */}
          <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-200 px-6 py-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 p-2 rounded-xl shadow-lg shadow-emerald-500/20">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tighter uppercase italic text-zinc-900">LogiTrack AI</h1>
            <p className="text-[10px] font-bold text-emerald-600 tracking-widest uppercase opacity-80">Logistics Thông Minh</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={checkConfig}
            className="p-2.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-full transition-all"
            title="Kiểm tra cấu hình"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={handleLogout}
            className="p-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
            title="Đăng xuất"
          >
            <LogOut className="w-5 h-5" />
          </button>
          {searchQuery && (
            <button 
              onClick={() => {
                setCapturedImage(null);
                setCurrentResult(null);
                setIsCameraActive(true);
              }}
              className="p-2.5 bg-emerald-500 text-white rounded-full transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
            >
              <Camera className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="pt-24 pb-32 max-w-lg mx-auto px-4 space-y-8 print:hidden">
        {/* Camera / Preview Section */}
        <section className="relative aspect-[3/4] bg-zinc-900 rounded-[2.5rem] overflow-hidden shadow-2xl ring-4 ring-white shadow-zinc-200/50 group">
          {!isCameraActive && !capturedImage && !isProcessing && !currentResult && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500">
                <CameraIcon className="w-10 h-10" />
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-white font-bold">Camera chưa sẵn sàng</h3>
                  <p className="text-zinc-400 text-sm">Vui lòng cấp quyền truy cập camera để bắt đầu chụp ảnh phương tiện.</p>
                </div>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => setIsCameraActive(true)}
                    className="w-full px-6 py-3 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
                  >
                    <CameraIcon className="w-5 h-5" />
                    Kích hoạt Camera
                  </button>
                  <label className="w-full cursor-pointer px-6 py-3 bg-zinc-800 text-zinc-300 font-bold rounded-2xl hover:bg-zinc-700 transition-all flex items-center justify-center gap-2 border border-zinc-700">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    <Upload className="w-5 h-5" />
                    Tải ảnh từ máy
                  </label>
                </div>
              </div>
            </div>
          )}

          {isCameraActive && !capturedImage && !isProcessing && !currentResult && (
            <div className="absolute inset-0">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className={`w-full h-full object-cover cursor-crosshair transition-all duration-700 ${!location ? 'blur-2xl scale-110' : 'blur-0 scale-100'}`}
                style={{ filter: `brightness(${focusPoint ? '1.4' : '1.15'}) contrast(1.05) saturate(1.1) ${!location ? 'blur(20px)' : 'blur(0px)'}` }}
                onClick={handleVideoClick}
              />
              
              {!location && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm text-white z-10">
                  <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
                  <p className="font-black text-lg uppercase tracking-widest animate-pulse">Đang tải tọa độ GPS...</p>
                  <p className="text-xs opacity-60 mt-2">Vui lòng chờ để đảm bảo tính xác thực</p>
                </div>
              )}

              {/* Professional Camera UI Overlays */}
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner Markers */}
                <div className="absolute top-8 left-8 w-8 h-8 border-t-2 border-l-2 border-white/40 rounded-tl-lg" />
                <div className="absolute top-8 right-8 w-8 h-8 border-t-2 border-r-2 border-white/40 rounded-tr-lg" />
                <div className="absolute bottom-8 left-8 w-8 h-8 border-b-2 border-l-2 border-white/40 rounded-bl-lg" />
                <div className="absolute bottom-8 right-8 w-8 h-8 border-b-2 border-r-2 border-white/40 rounded-br-lg" />
                
                {/* Grid Lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20">
                  <div className="border-r border-white/30" />
                  <div className="border-r border-white/30" />
                  <div />
                  <div className="border-b border-white/30 col-span-3" />
                  <div className="border-b border-white/30 col-span-3" />
                </div>
              </div>
              
              {/* Focus Indicator (iPhone style) */}
              <AnimatePresence>
                {focusPoint && (
                  <motion.div 
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute pointer-events-none border border-yellow-400 w-16 h-16 flex items-center justify-center"
                    style={{ left: focusPoint.x - 32, top: focusPoint.y - 32 }}
                  >
                    <div className="w-1 h-1 bg-yellow-400 rounded-full" />
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-yellow-400" />
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-yellow-400" />
                    <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-1.5 h-0.5 bg-yellow-400" />
                    <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-1.5 h-0.5 bg-yellow-400" />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Real-time Overlay */}
              <div className="absolute top-6 left-6 w-[50%] p-3 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 text-white text-[10px] font-mono space-y-1 drop-shadow-md z-20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-emerald-400" />
                    <span className="font-bold">{currentTime.toLocaleTimeString('vi-VN')}</span>
                  </div>
                  <div className={`w-1.5 h-1.5 ${location ? 'bg-emerald-500' : 'bg-red-500'} rounded-full animate-pulse`} />
                </div>
                <div className="flex items-start gap-2 overflow-hidden">
                  <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="marquee-container w-full">
                    <span className="animate-marquee-bounce font-black text-[8.5px] uppercase tracking-tight text-emerald-50">
                      {locationName} • {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Đang định vị...'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Upload Button (Top Right) */}
              <div className="absolute top-6 right-6 z-30">
                <label className="cursor-pointer p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/20 text-white flex items-center justify-center hover:bg-black/50 transition-all shadow-lg">
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  <Upload className="w-5 h-5" />
                </label>
              </div>

              {/* Camera Controls */}
              <AnimatePresence>
                {location && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute bottom-10 left-0 right-0 flex justify-center items-center gap-8"
                  >
                    <motion.button 
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleFlash}
                      className={`relative overflow-hidden p-4 rounded-full transition-all border shadow-lg group ${isFlashOn ? 'bg-yellow-400 border-yellow-300 text-black' : 'bg-white/20 backdrop-blur-xl border-white/30 text-white'}`}
                    >
                      <Flashlight className={`w-6 h-6 ${isFlashOn ? 'fill-current' : ''}`} />
                    </motion.button>

                    <div className="flex flex-col items-center gap-2">
                      <motion.button 
                        whileHover={{ scale: location ? 1.05 : 1 }}
                        whileTap={{ scale: location ? 0.9 : 1 }}
                        onClick={capturePhoto}
                        disabled={!location}
                        className={`relative w-24 h-24 rounded-full border-[8px] border-white/50 flex items-center justify-center transition-all shadow-[0_0_30px_rgba(255,255,255,0.3)] bg-white/20 backdrop-blur-sm group ${!location ? 'opacity-30 cursor-not-allowed' : ''}`}
                      >
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent rounded-full pointer-events-none" />
                        <div className="w-16 h-16 rounded-full bg-white shadow-inner group-active:bg-zinc-100 transition-colors flex items-center justify-center">
                           <CameraIcon className="w-8 h-8 text-emerald-600" />
                        </div>
                      </motion.button>
                      <span className="text-[9px] font-black text-white uppercase tracking-[0.2em] drop-shadow-lg">Chụp & Phân tích</span>
                    </div>

                    <motion.button 
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleCamera}
                      className="relative overflow-hidden p-4 bg-white/20 backdrop-blur-xl rounded-full text-white hover:bg-white/30 transition-all border border-white/30 shadow-lg group"
                    >
                      <motion.div
                        animate={{ rotate: [0, 180] }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        key={isCameraActive ? 'front' : 'back'}
                      >
                        <RefreshCw className="w-6 h-6" />
                      </motion.div>
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {(capturedImage || currentResult || isProcessing) && (
            <div className="absolute inset-0">
              {(capturedImage || currentResult?.imageUrl) && (
                <img 
                  src={capturedImage || currentResult?.imageUrl || ''} 
                  className="w-full h-full object-cover" 
                  style={{ filter: 'brightness(1.15) contrast(1.05) saturate(1.1)' }}
                  alt="Captured" 
                  onError={() => {
                    setError("Không thể hiển thị hình ảnh. Vui lòng thử lại.");
                    resetCapture();
                  }}
                />
              )}
              
              {/* Post-Capture Data Overlay */}
              <div className="absolute top-6 left-6 w-[50%] p-3 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/20 text-white space-y-1 shadow-2xl z-20">
                <div className="flex items-center justify-between border-b border-white/10 pb-1 mb-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-emerald-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest">
                      {currentResult ? new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short' }).format(new Date(currentResult.timestamp)) : new Date().toLocaleTimeString('vi-VN')}
                    </span>
                  </div>
                  <span className="text-[7px] font-black bg-emerald-500 px-1.5 py-0.5 rounded-full uppercase">Verified</span>
                </div>
                <div className="flex items-start gap-2 overflow-hidden">
                  <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="marquee-container w-full">
                    <span className="animate-marquee-bounce text-[8.5px] font-black uppercase tracking-tight">
                      {currentResult?.location?.address || locationName} • {(currentResult?.location?.lat || location?.lat || 0).toFixed(6)}, {(currentResult?.location?.lng || location?.lng || 0).toFixed(6)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Retake Button */}
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={resetCapture}
                className="absolute bottom-6 right-6 p-4 bg-white/20 backdrop-blur-xl border border-white/30 rounded-full text-white shadow-2xl hover:bg-white/30 transition-all active:scale-95 z-30"
              >
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <CameraIcon className="w-6 h-6" />
                </motion.div>
              </motion.button>
            </div>
          )}
        </section>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-50 border border-red-100 p-5 rounded-3xl flex flex-col gap-4 text-red-600 shadow-xl"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-red-100 rounded-full shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="text-sm">
                  <p className="font-black uppercase tracking-wider mb-1">Cảnh báo hệ thống</p>
                  <p className="font-medium leading-relaxed">{error}</p>
                  <p className="mt-2 text-[11px] opacity-70 italic">Mẹo: Nếu camera không hoạt động, bạn có thể chọn "Tải ảnh từ máy" để tiếp tục công việc.</p>
                  {error.includes("CAMERA") && (
                    <button 
                      onClick={() => {
                        setError(null);
                        setIsCameraActive(false);
                        setTimeout(() => setIsCameraActive(true), 100);
                      }}
                      className="mt-3 px-4 py-2 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all flex items-center gap-2 shadow-lg"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Thử lại ngay
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <label className="cursor-pointer px-4 py-2.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg">
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  <Upload className="w-3.5 h-3.5" />
                  Tải ảnh từ máy
                </label>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-4 py-2.5 bg-zinc-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-black transition-all flex items-center gap-2 shadow-lg"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Tải lại trang
                </button>
                <button 
                  onClick={() => {
                    setError(null);
                    setIsCameraActive(true);
                  }}
                  className="px-4 py-2.5 bg-zinc-200 text-zinc-700 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-zinc-300 transition-all flex items-center gap-2 shadow-lg"
                >
                  Thử lại
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result Card */}
        <AnimatePresence>
          {currentResult && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-zinc-100 space-y-8 ring-1 ring-zinc-200/50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => handleUpdateVehicleType('truck')}
                      className={`p-3 rounded-xl border-2 transition-all ${currentResult?.vehicleType === 'truck' ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg' : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:border-zinc-200'}`}
                    >
                      <Truck className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => handleUpdateVehicleType('ship')}
                      className={`p-3 rounded-xl border-2 transition-all ${currentResult?.vehicleType === 'ship' ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg' : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:border-zinc-200'}`}
                    >
                      <Ship className="w-5 h-5" />
                    </button>
                  </div>
                  <div>
                    <h3 className="font-black text-2xl tracking-tight italic uppercase text-zinc-900">
                      <RenderSanitized value={currentResult?.idNumber} />
                    </h3>
                    <p className="text-[10px] text-emerald-600 uppercase tracking-[0.2em] font-black opacity-80">
                      {currentResult?.vehicleType === 'truck' ? 'Xe Vận Tải' : 'Tàu Thủy'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-emerald-600 font-black text-lg italic">
                    <CheckCircle2 className="w-5 h-5" />
                    {Math.round((currentResult?.confidence || 0) * 100)}%
                  </div>
                  <p className="text-[9px] text-zinc-400 uppercase font-black tracking-widest">Độ tin cậy</p>
                </div>
              </div>

              {/* Vehicle ID, Product Type & Volume Inputs */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 px-1">
                    <QrCode className="w-3 h-3 text-emerald-500" /> Biển số / Số hiệu <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text"
                    value={idNumberInput}
                    onChange={(e) => handleUpdateIdNumber(e.target.value.toUpperCase())}
                    placeholder="NHẬP BIỂN SỐ / SỐ HIỆU"
                    className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all text-zinc-900 outline-none placeholder:text-zinc-300 uppercase"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 px-1">
                    <Smartphone className="w-3 h-3 text-emerald-500" /> Mã khách hàng
                  </label>
                  <input 
                    type="text"
                    value={customerCodeInput}
                    onChange={(e) => handleUpdateCustomerCode(e.target.value.toUpperCase())}
                    placeholder="NHẬP MÃ KHÁCH HÀNG"
                    className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all text-zinc-900 outline-none placeholder:text-zinc-300 uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 px-1">
                      <Box className="w-3 h-3 text-emerald-500" /> Loại hàng <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select 
                        value={currentResult?.productType || productType}
                        onChange={(e) => handleUpdateProductType(e.target.value as 'Cát' | 'Đất')}
                        className="w-full bg-emerald-50 border-2 border-emerald-100 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all appearance-none text-emerald-900 outline-none"
                      >
                        <option value="Cát" className="bg-white">Cát</option>
                        <option value="Đất" className="bg-white">Đất</option>
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-400">
                        <RefreshCw className="w-4 h-4 rotate-90" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 px-1">
                      <Truck className="w-3 h-3 text-blue-500" /> Số m³ <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text"
                      inputMode="decimal"
                      value={volumeInput}
                      onChange={(e) => handleUpdateVolume(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-blue-50 border-2 border-blue-100 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all text-blue-900 outline-none placeholder:text-blue-300"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <MapPin className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold leading-snug text-zinc-800">{currentResult?.location?.address || "Đang cập nhật..."}</p>
                    <p className="text-[10px] text-zinc-400 font-mono mt-1">
                      {(currentResult?.location?.lat || 0).toFixed(6)}, {(currentResult?.location?.lng || 0).toFixed(6)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 p-6 bg-zinc-50 rounded-[2rem] border border-zinc-100 mb-4">
                {currentResult && (
                  <QRCodeSVG 
                    value={getQrData(currentResult)} 
                    size={140} 
                    level="H" 
                    imageSettings={{
                      src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyMCIgZmlsbD0iIzEwYjk4MSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmb250LXNpemU9IjQwIiBmaWxsPSJ3aGl0ZSI+UFROPC90ZXh0Pjwvc3ZnPg==",
                      height: 30,
                      width: 30,
                      excavate: true,
                    }}
                  />
                )}
                <div 
                  onClick={() => setShowQrContent(!showQrContent)}
                  className="flex flex-col items-center gap-2 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-white rounded-full border border-zinc-200 group-hover:border-emerald-500/30 group-hover:shadow-sm transition-all">
                    <QrCode className="w-3.5 h-3.5 text-zinc-400 group-hover:text-emerald-500 transition-colors" />
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] group-hover:text-emerald-600 transition-colors">
                      {showQrContent ? "Ẩn nội dung QR" : "Mã QR Bảo Mật"}
                    </span>
                  </div>
                  {showQrContent && currentResult && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full max-w-[200px] p-3 bg-white rounded-xl border border-zinc-200 shadow-sm text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-words text-center"
                    >
                      {getQrData(currentResult)}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Delete Button - Red Glossy */}
              <div className="pt-2">
                <motion.button
                  whileHover={{ scale: 1.02, brightness: 1.1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={(e) => currentResult && handleDeleteRecord(currentResult.id, e as any)}
                  disabled={isDeletingFromSheet}
                  className="w-full relative overflow-hidden py-4 bg-gradient-to-b from-red-500 to-red-700 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 shadow-[0_10px_20px_rgba(239,68,68,0.3)] border-t border-white/20 group"
                >
                  {/* Glossy Effect Overlay */}
                  <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
                  
                  {isDeletingFromSheet ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Trash2 className="w-5 h-5 group-hover:animate-bounce" />
                  )}
                  {isDeletingFromSheet ? "Đang xóa..." : "Xóa chuyến này"}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sticky Action Buttons */}
        <AnimatePresence>
          {currentResult && (
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white/20 backdrop-blur-2xl border-t border-zinc-200 py-3 px-6 flex gap-4 max-w-lg mx-auto rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]"
            >
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleOpenPrint}
                disabled={isSavingToSheet}
                className={`flex-[2] relative overflow-hidden py-2.5 ${isSavingToSheet ? 'bg-zinc-400' : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600'} text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-[0_5px_15px_rgba(16,185,129,0.2)]`}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                {isSavingToSheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Printer className="w-3.5 h-3.5" />
                )}
                {isSavingToSheet ? 'Đang lưu Sheet...' : 'Lưu và In Phiếu'}
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={resetCapture}
                className="flex-1 relative overflow-hidden py-2.5 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-[0_5px_15px_rgba(59,130,246,0.2)]"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                <CameraIcon className="w-3.5 h-3.5" />
                Chụp lại
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

  {/* Debug Info Overlay */}
        <AnimatePresence>
          {debugInfo && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6"
              onClick={() => setDebugInfo(null)}
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black uppercase tracking-tight italic">Kiểm tra cấu hình</h3>
                  <button onClick={() => setDebugInfo(null)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <span className="text-sm font-bold text-zinc-500">Gemini API Key</span>
                    {debugInfo.geminiKey ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
                  </div>

                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-500">Google Service Account</span>
                      {debugInfo.serviceAccountKey.validJson ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
                    </div>
                    {debugInfo.serviceAccountKey.isUrl && (
                      <p className="text-[10px] text-red-500 font-medium">LỖI: Bạn đã dán một URL thay vì nội dung file JSON. Vui lòng copy nội dung file .json đã tải về.</p>
                    )}
                    {debugInfo.serviceAccountKey.error && !debugInfo.serviceAccountKey.isUrl && (
                      <p className="text-[10px] text-red-500 font-medium">LỖI: {debugInfo.serviceAccountKey.error}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <span className="text-sm font-bold text-zinc-500">Google Sheet ID</span>
                    <span className="text-[10px] font-mono bg-zinc-200 px-2 py-1 rounded-lg truncate max-w-[150px]">{debugInfo.sheetsId.value}</span>
                  </div>
                </div>

                <button 
                  onClick={() => setDebugInfo(null)}
                  className="w-full py-4 bg-zinc-900 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-black transition-all"
                >
                  Đóng
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History Section */}
        {!currentResult && (
          <section className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h2 className="font-black text-[10px] text-zinc-400 uppercase tracking-[0.25em]">
                  {searchQuery ? "Kết quả tìm kiếm" : "Lịch sử hôm nay"}
                </h2>
                <div className="flex items-center gap-2">
                  {history.length > 0 && !searchQuery && (
                    <button 
                      onClick={clearAllHistory}
                      className="text-[9px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors mr-2"
                    >
                      Xóa tất cả
                    </button>
                  )}
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase">
                    {filteredHistory.length} {searchQuery ? "Kết quả" : "Chuyến"}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <div className="relative shrink-0">
                  <select 
                    value={searchType}
                    onChange={(e) => {
                      setSearchType(e.target.value as any);
                      setCurrentPage(1);
                    }}
                    className="h-full bg-emerald-50 border-2 border-emerald-100 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all appearance-none text-emerald-900 outline-none pr-10 min-w-[130px] shadow-sm"
                  >
                    <option value="all" className="bg-white">Tất cả</option>
                    <option value="id" className="bg-white">Mã phiếu</option>
                    <option value="idNumber" className="bg-white">Số hiệu PT</option>
                    <option value="customerCode" className="bg-white">Mã KH</option>
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-emerald-400">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>

                <div className="relative group flex-1">
                  <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                    <Search className="w-4 h-4 text-emerald-400 group-focus-within:text-emerald-500 transition-colors" />
                  </div>
                  <input 
                    type="text"
                    placeholder={
                      searchType === 'all' ? "Tìm kiếm..." :
                      searchType === 'id' ? "Nhập mã phiếu..." :
                      searchType === 'idNumber' ? "Nhập biển số / số hiệu..." :
                      "Nhập mã khách hàng..."
                    }
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full bg-emerald-50 border-2 border-emerald-100 rounded-2xl py-4 pl-12 pr-12 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all text-emerald-900 outline-none shadow-sm placeholder:text-emerald-200"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => {
                        setSearchQuery("");
                        setCurrentPage(1);
                      }}
                      className="absolute inset-y-0 right-4 flex items-center text-emerald-400 hover:text-emerald-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {filteredHistory.length > 1 && (
                  <div className="flex items-center gap-2">
                    {/* Cloud buttons removed */}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4">
              {paginatedHistory.length > 0 ? (
                <>
                  {paginatedHistory.map((record) => (
                    <motion.div 
                      key={record.id}
                      layout
                      onClick={() => {
                        setCurrentResult(record);
                        setVolumeInput(record.volume || "");
                        setIdNumberInput(record.idNumber && record.idNumber !== '---' ? record.idNumber : "");
                        setCustomerCodeInput(record.customerCode || "");
                        setProductType(record.productType || "Cát");
                        setShowQrContent(false);
                        setIsNewRecord(false);
                        setIsModified(false);
                        stopCamera();
                      }}
                      className="bg-white p-4 rounded-3xl border border-zinc-200 flex items-center gap-4 hover:border-emerald-500/30 hover:shadow-lg transition-all group cursor-pointer active:scale-[0.98] w-full max-w-full overflow-hidden"
                    >
                      <div className="relative w-16 h-16 shrink-0">
                        <img src={record.imageUrl} className="w-full h-full rounded-2xl object-cover ring-1 ring-zinc-100" alt="Lịch sử" />
                        <div className="absolute -bottom-1 -right-1 bg-emerald-500 p-1 rounded-lg border-2 border-white">
                          {record.vehicleType === 'truck' ? <Truck className="w-2.5 h-2.5 text-white" /> : <Ship className="w-2.5 h-2.5 text-white" />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-black text-base tracking-tight italic uppercase text-zinc-900 leading-tight">
                              <RenderSanitized value={record?.idNumber} />
                            </h4>
                            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">#{record.id.slice(-8)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={(e) => handleEditRecord(record, e)}
                              className="p-1.5 text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={(e) => handleDeleteRecord(record.id, e)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="marquee-container">
                          <p className="text-xs text-zinc-500 font-medium animate-marquee-bounce inline-block">
                            {record?.location?.address || "Vị trí không xác định"}
                          </p>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <span className="text-[9px] text-zinc-400 font-bold">
                            {(() => {
                              try {
                                return new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short' }).format(new Date(record.timestamp));
                              } catch (e) {
                                return "---";
                              }
                            })()}
                          </span>
                          {record?.productType && (
                            <span className="text-[9px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter border border-emerald-100">
                              {record.productType}
                            </span>
                          )}
                          {record?.volume && (
                            <span className="text-[9px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter border border-blue-100">
                              {record.volume} m³
                            </span>
                          )}
                          {record?.customerCode && (
                            <span className="text-[9px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter border border-zinc-200">
                              {record.customerCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-4 mt-6 pb-4">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className={`p-3 rounded-2xl border-2 transition-all ${currentPage === 1 ? 'bg-zinc-50 border-zinc-100 text-zinc-300' : 'bg-white border-zinc-100 text-zinc-600 hover:border-emerald-500/30 hover:text-emerald-600 active:scale-95'}`}
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      
                      <div className="flex items-center gap-2">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`w-10 h-10 rounded-xl text-[10px] font-black transition-all ${currentPage === page ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-white border border-zinc-100 text-zinc-400 hover:border-zinc-200'}`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className={`p-3 rounded-2xl border-2 transition-all ${currentPage === totalPages ? 'bg-zinc-50 border-zinc-100 text-zinc-300' : 'bg-white border-zinc-100 text-zinc-600 hover:border-emerald-500/30 hover:text-emerald-600 active:scale-95'}`}
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center space-y-3 bg-white rounded-[2.5rem] border-2 border-dashed border-zinc-100">
                  <div className="bg-zinc-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                    <History className="w-6 h-6 text-zinc-300" />
                  </div>
                  <p className="text-sm font-bold text-zinc-400">Không tìm thấy dữ liệu phù hợp</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </>
  )}
      {/* Edit Modal */}
      <AnimatePresence>
        {isEditing && editForm && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditing(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-black text-xl uppercase italic tracking-tight">Chỉnh sửa thông tin</h3>
                <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">Loại phương tiện</label>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setEditForm({ ...editForm, vehicleType: 'truck' })}
                      className={`flex-1 py-3 rounded-2xl border-2 flex items-center justify-center gap-2 transition-all ${editForm.vehicleType === 'truck' ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg' : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:border-zinc-200'}`}
                    >
                      <Truck className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Xe tải</span>
                    </button>
                    <button 
                      onClick={() => setEditForm({ ...editForm, vehicleType: 'ship' })}
                      className={`flex-1 py-3 rounded-2xl border-2 flex items-center justify-center gap-2 transition-all ${editForm.vehicleType === 'ship' ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg' : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:border-zinc-200'}`}
                    >
                      <Ship className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Tàu thủy</span>
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">Biển số / Số hiệu</label>
                  <input 
                    type="text"
                    value={editForm.idNumber}
                    onChange={(e) => setEditForm({ ...editForm, idNumber: e.target.value })}
                    className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-4 text-sm font-bold focus:border-emerald-500 outline-none transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">Loại hàng</label>
                    <select 
                      value={editForm.productType}
                      onChange={(e) => setEditForm({ ...editForm, productType: e.target.value as 'Cát' | 'Đất' })}
                      className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-4 text-sm font-bold focus:border-emerald-500 outline-none transition-all"
                    >
                      <option value="Cát">Cát</option>
                      <option value="Đất">Đất</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">Số m³</label>
                    <input 
                      type="text"
                      value={editForm.volume}
                      onChange={(e) => setEditForm({ ...editForm, volume: e.target.value })}
                      className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-4 text-sm font-bold focus:border-emerald-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="flex-1 py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-black uppercase tracking-widest text-xs"
                >
                  Hủy
                </button>
                <button 
                  onClick={saveEdit}
                  className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-500/20"
                >
                  Lưu thay đổi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Print View Modal */}
      <AnimatePresence>
        {showPrintView && currentResult && (
          <div className="fixed inset-0 z-[100] bg-zinc-900/60 backdrop-blur-md print:bg-white print:overflow-visible">
            {/* Scrollable Content Area */}
            <div className="absolute inset-0 overflow-y-auto pb-40 print:relative print:pb-0 print:overflow-visible flex flex-col items-center">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full flex flex-col items-center py-10 px-4 print:py-0 print:px-0"
              >
                {/* Delivery Note Content */}
                <div id="printable-ticket" className={`bg-white shadow-[0_30px_100px_rgba(0,0,0,0.2)] print:shadow-none transition-all duration-500 ${isThermalMode ? 'w-[80mm] min-h-[120mm] p-6' : 'w-[148mm] min-h-[210mm] p-10'} text-black relative overflow-hidden rounded-[2rem] print:rounded-none`}>
                  {/* Decorative Elements for A5 mode */}
                  {!isThermalMode && (
                    <>
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-zinc-900" />
                    </>
                  )}

                  {/* Header */}
                  <div className="flex flex-col items-center text-center border-b-2 border-zinc-900 pb-4 mb-6 space-y-3">
                    <div className="space-y-1">
                      <h2 className={`${isThermalMode ? 'text-[11px]' : 'text-base'} font-black uppercase tracking-tight leading-tight text-zinc-900`}>{COMPANY_INFO.name}</h2>
                      <div className="flex items-center justify-center gap-2">
                        <span className="bg-zinc-900 text-white text-[8px] px-1.5 py-0.5 font-black rounded uppercase">MST</span>
                        <p className={`${isThermalMode ? 'text-[9px]' : 'text-[11px]'} font-bold text-zinc-600`}>{COMPANY_INFO.taxId}</p>
                      </div>
                      <p className={`${isThermalMode ? 'text-[8px]' : 'text-[10px]'} text-zinc-500 max-w-xs leading-tight mx-auto font-medium`}>{COMPANY_INFO.address}</p>
                    </div>
                    <div className="w-full pt-3 border-t border-dashed border-zinc-200">
                      <h1 className={`${isThermalMode ? 'text-xl' : 'text-3xl'} font-black uppercase tracking-tighter text-zinc-900 italic`}>Phiếu Xuất Kho</h1>
                      <p className={`${isThermalMode ? 'text-[9px]' : 'text-[11px]'} font-bold text-zinc-600 uppercase tracking-wider mt-0.5 whitespace-nowrap`}>Dự án nạo vét Đông Hải</p>
                      <div className="mt-1.5 flex items-center justify-center gap-2">
                        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Số phiếu:</span>
                        <span className="text-[11px] font-black font-mono text-zinc-900">{currentResult?.id || '---'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Main Info Grid */}
                  <div className={`grid ${isThermalMode ? 'grid-cols-1 gap-4' : 'grid-cols-2 gap-6'}`}>
                    {/* Left Column: Vehicle & Cargo */}
                    <div className={`${isThermalMode ? 'space-y-1' : 'space-y-4'} flex-1`}>
                      <div className="space-y-2">
                        <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-400 border-b border-zinc-100 pb-1">Thông tin vận chuyển</h4>
                        
                        {isThermalMode ? (
                          <div className="flex items-center justify-between gap-2">
                            {/* 3 Lines Stack for Thermal */}
                            <div className="space-y-1.5 flex-1">
                              <div>
                                <p className="text-[7px] font-bold text-zinc-400 uppercase tracking-widest">Biển số / Số hiệu</p>
                                <p className="text-lg font-black italic tracking-tighter text-zinc-900 leading-none">
                                  <RenderSanitized value={currentResult?.idNumber} />
                                </p>
                              </div>
                              <div className="flex items-baseline gap-1">
                                <p className="text-[7px] font-black text-zinc-400 uppercase tracking-widest">Mã KH:</p>
                                <p className="text-[10px] font-black text-zinc-900 truncate">
                                  <RenderSanitized value={currentResult?.customerCode} />
                                </p>
                              </div>
                              <div className="flex items-baseline gap-1">
                                <p className="text-[7px] font-black text-zinc-400 uppercase tracking-widest">Loại hàng:</p>
                                <p className="text-xs font-black text-zinc-900 truncate">
                                  <RenderSanitized value={currentResult?.productType} />
                                </p>
                              </div>
                              <div className="flex items-baseline gap-1">
                                <p className="text-[7px] font-black text-zinc-400 uppercase tracking-widest">Khối lượng:</p>
                                <div className="flex items-baseline gap-0.5">
                                  <p className="text-base font-black text-zinc-900 leading-none">{currentResult?.volume || '0'}</p>
                                  <p className="text-[8px] font-black text-zinc-500 uppercase">m³</p>
                                </div>
                              </div>
                            </div>

                            {/* QR Code for 80mm mode */}
                            <div className="flex flex-col items-center gap-1 shrink-0">
                              <div className="p-1 bg-white border-2 border-zinc-900 rounded-lg">
                                <QRCodeSVG 
                                  value={getQrData(currentResult!)} 
                                  size={82} 
                                  level="H" 
                                  imageSettings={{
                                    src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyMCIgZmlsbD0iIzEwYjk4MSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmb250LXNpemU9IjQwIiBmaWxsPSJ3aGl0ZSI+UFROPC90ZXh0Pjwvc3ZnPg==",
                                    height: 18,
                                    width: 18,
                                    excavate: true,
                                  }}
                                />
                              </div>
                              <p className="text-[6px] font-black text-zinc-400 uppercase tracking-[0.1em] text-center leading-tight">Mã xác thực</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-zinc-50 rounded-xl border border-zinc-100">
                                <Smartphone className="w-5 h-5 text-zinc-900" />
                              </div>
                              <div>
                                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Mã khách hàng</p>
                                <p className="text-xl font-black italic tracking-tighter text-zinc-900">
                                  <RenderSanitized value={currentResult?.customerCode} />
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-zinc-50 rounded-xl border border-zinc-100">
                                {currentResult?.vehicleType === 'truck' ? <Truck className="w-5 h-5 text-zinc-900" /> : <Ship className="w-5 h-5 text-zinc-900" />}
                              </div>
                              <div>
                                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Biển số / Số hiệu</p>
                                <p className="text-2xl font-black italic tracking-tighter text-zinc-900">
                                  <RenderSanitized value={currentResult?.idNumber} />
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {!isThermalMode && (
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Loại hàng hóa:</p>
                            <p className="text-sm font-black text-zinc-900">
                              <RenderSanitized value={currentResult?.productType} />
                            </p>
                          </div>
                          <div className="flex items-baseline gap-2">
                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Khối lượng thực tế:</p>
                            <div className="flex items-baseline gap-1">
                              <p className="text-lg font-black text-zinc-900">{currentResult?.volume || '0'}</p>
                              <p className="text-[10px] font-black text-zinc-500 uppercase">m³</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Time & Location */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-400 border-b border-zinc-100 pb-1">Thời gian & Địa điểm</h4>
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 p-1 bg-zinc-100 rounded-md">
                              <Clock className="w-2.5 h-2.5 text-zinc-500" />
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Thời gian</p>
                              <p className="text-[10px] font-black text-zinc-900">
                                {(() => {
                                  try {
                                    return new Intl.DateTimeFormat('vi-VN', { 
                                      dateStyle: 'medium', 
                                      timeStyle: 'short' 
                                    }).format(new Date(currentResult?.timestamp || Date.now()));
                                  } catch (e) {
                                    return "---";
                                  }
                                })()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 p-1 bg-zinc-100 rounded-md">
                              <MapPin className="w-2.5 h-2.5 text-zinc-500" />
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Địa điểm</p>
                              <p className="text-[9px] font-bold text-zinc-800 leading-tight">{currentResult?.location?.address || 'Chưa xác định'}</p>
                            </div>
                          </div>

                          {/* QR Code for A5 mode - below location */}
                          {!isThermalMode && (
                            <div className="pt-4 flex flex-col items-center gap-2">
                              <div className="p-2 bg-white border-2 border-zinc-900 rounded-2xl shadow-sm">
                                <QRCodeSVG 
                                  value={getQrData(currentResult!)} 
                                  size={100} 
                                  level="H" 
                                  imageSettings={{
                                    src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyMCIgZmlsbD0iIzEwYjk4MSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmb250LXNpemU9IjQwIiBmaWxsPSJ3aGl0ZSI+UFROPC90ZXh0Pjwvc3ZnPg==",
                                    height: 22,
                                    width: 22,
                                    excavate: true,
                                  }}
                                />
                              </div>
                              <div className="text-center">
                                <p className="text-[8px] font-black text-zinc-900 uppercase tracking-[0.2em]">Mã xác thực điện tử</p>
                                <p className="text-[6px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5 italic">Quét để kiểm tra tính hợp lệ</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer / Signatures */}
                  <div className="mt-6 pt-4 border-t border-zinc-100 grid grid-cols-2 gap-4 text-center">
                    <div className="space-y-8">
                      <p className="text-[8px] font-black uppercase tracking-widest">Người giao</p>
                    </div>
                    <div className="space-y-8">
                      <p className="text-[8px] font-black uppercase tracking-widest">Người nhận</p>
                    </div>
                  </div>

                  {/* Print Footer */}
                  <div className="mt-8 text-center border-t border-zinc-100 pt-4">
                    <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-[0.3em]">Hệ thống quản lý nạo vét thông minh v2.0</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Fixed Controls Footer - Hidden on Print */}
            <div className="fixed bottom-0 left-0 right-0 z-[120] p-4 sm:p-6 bg-white/90 backdrop-blur-2xl border-t border-zinc-200 print:hidden shadow-[0_-10px_50px_rgba(0,0,0,0.15)]">
              <div className="max-w-2xl mx-auto flex items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <motion.div
                      animate={{ 
                        scale: [1, 1.1, 1],
                        filter: ["drop-shadow(0 0 2px rgba(220, 38, 38, 0.3))", "drop-shadow(0 0 8px rgba(220, 38, 38, 0.6))", "drop-shadow(0 0 2px rgba(220, 38, 38, 0.3))"]
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Eye className="w-5 h-5 sm:w-6 sm:h-6" />
                    </motion.div>
                    <span className="text-[12px] sm:text-sm font-black uppercase tracking-[0.1em] drop-shadow-sm">Xem in</span>
                  </div>
                  <div className="hidden xs:block border-l border-zinc-200 pl-3">
                    <h3 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-900">Xem trước phiếu in</h3>
                    <p className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-tight">Kiểm tra thông tin trước khi xuất</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 flex-1 justify-end">
                  <button 
                    onClick={() => setIsThermalMode(!isThermalMode)}
                    className={`h-10 sm:h-12 px-3 sm:px-5 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all border-2 ${isThermalMode ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100'}`}
                  >
                    {isThermalMode ? 'Khổ 80mm' : 'Khổ A5'}
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="h-10 sm:h-12 px-4 sm:px-6 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-600 text-white rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:from-blue-600 hover:to-blue-700 transition-all shadow-xl shadow-blue-500/30 flex items-center gap-2 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                    <Printer className="w-3.5 h-3.5 sm:w-4 h-4" />
                    <span className="hidden xs:inline">In Phiếu</span>
                    <span className="xs:hidden">In</span>
                  </button>

                  <button 
                    onClick={() => {
                      setShowPrintView(false);
                      setCurrentResult(null);
                      setCapturedImage(null);
                      setIsCameraActive(true);
                      setIsProcessing(false);
                    }}
                    className="h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-xl sm:rounded-2xl text-zinc-500 transition-all border border-zinc-200"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-zinc-100"
            >
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-black text-zinc-900 mb-2 uppercase tracking-tight">Xác nhận xóa?</h3>
                <p className="text-zinc-500 text-sm leading-relaxed mb-8">
                  Bạn có chắc chắn muốn xóa chuyến đi này? <br/>
                  Dữ liệu sẽ bị gỡ bỏ vĩnh viễn khỏi hệ thống và Google Sheet.
                </p>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={confirmDelete}
                    disabled={isDeletingFromSheet}
                    className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold transition-all shadow-lg shadow-red-200 flex items-center justify-center gap-2"
                  >
                    {isDeletingFromSheet ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5" />
                    )}
                    {isDeletingFromSheet ? "Đang xóa..." : "Xóa vĩnh viễn"}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeletingFromSheet}
                    className="w-full py-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-2xl font-bold transition-all"
                  >
                    Không xóa
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
