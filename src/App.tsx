import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  FileText, 
  MessageSquare, 
  Plus, 
  Search, 
  Trash2, 
  Upload, 
  X,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  Menu,
  Shield,
  ShieldAlert,
  Send,
  UserCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  updateDoc, 
  deleteDoc, 
  doc,
  Timestamp,
  writeBatch
} from 'firebase/firestore';

interface Comment {
  text: string;
  createdAt: any;
  author: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  due_date: string;
  status: 'pending' | 'completed';
  source: string;
  source_content?: string;
  created_at: any;
  requester?: string;
  assignee?: string;
  ai_execution_plan?: string;
  priority?: string;
  completed_at?: any;
  comments?: Comment[];
  is_guide_confirmed?: boolean;
}

export default function App() {
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'team'>('pending');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const [showTextInput, setShowTextInput] = useState(false);
  const [rawText, setRawText] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [companyContext, setCompanyContext] = useState('');
  
  // Comment Input State
  const [newComment, setNewComment] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('팀원');

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Load company context
  useEffect(() => {
    fetch('/company_context.txt')
      .then(res => res.text())
      .then(text => setCompanyContext(text))
      .catch(err => console.error('Failed to load company context:', err));
  }, []);

  // Fetch Tasks
  useEffect(() => {
    setIsLoading(true);
    const q = query(collection(db, 'tasks'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskList);
      setIsLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const toggleTaskStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
    try {
      await updateDoc(doc(db, 'tasks', id), { 
        status: newStatus,
        completed_at: newStatus === 'completed' ? Timestamp.now() : null
      });
      if (selectedTask?.id === id) {
        setSelectedTask(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err) {
      console.error('Failed to update task', err);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', id));
      setSelectedTask(null);
    } catch (err) {
      console.error('Failed to delete task', err);
    }
  };

  const addComment = async () => {
    if (!selectedTask || !newComment.trim()) return;
    const commentObj: Comment = {
      text: newComment,
      author: isAdminMode ? '관리자' : commentAuthor,
      createdAt: Timestamp.now()
    };
    
    try {
      const currentComments = selectedTask.comments || [];
      await updateDoc(doc(db, 'tasks', selectedTask.id), {
        comments: [...currentComments, commentObj]
      });
      setSelectedTask(prev => prev ? { ...prev, comments: [...currentComments, commentObj] } : null);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment', err);
    }
  };

  const updateAssignee = async (assigneeName: string) => {
    if (!selectedTask || !isAdminMode) return;
    try {
      await updateDoc(doc(db, 'tasks', selectedTask.id), { assignee: assigneeName });
      setSelectedTask(prev => prev ? { ...prev, assignee: assigneeName } : null);
    } catch (err) {
      console.error('Failed to update assignee', err);
    }
  };

  const confirmGuide = async () => {
    if (!selectedTask || !isAdminMode) return;
    try {
      await updateDoc(doc(db, 'tasks', selectedTask.id), { is_guide_confirmed: true });
      setSelectedTask(prev => prev ? { ...prev, is_guide_confirmed: true } : null);
    } catch (err) {
      console.error('Failed to confirm guide', err);
    }
  };

  const updateGuideText = async (newText: string) => {
    if (!selectedTask || !isAdminMode) return;
    try {
      await updateDoc(doc(db, 'tasks', selectedTask.id), { ai_execution_plan: newText });
      setSelectedTask(prev => prev ? { ...prev, ai_execution_plan: newText } : null);
    } catch (err) {
      console.error('Failed to update guide text', err);
    }
  };

  const generateAIPrompt = () => {
    const pendingTasks = tasks
      .filter(t => t.status === 'pending')
      .map(t => `- [${t.priority || '보통'}] ${t.title} (기한: ${t.due_date || '없음'})`)
      .join('\n');

    return `You are a specialized task management AI for 한국수자원조사기술원 금강권역실.
    
Company Background:
${companyContext}

Current Pending Tasks (For Priority Context):
${pendingTasks || '없음'}

Instruction: Analyze the provided source document/text and extract exactly ONE main task.
Return ONLY a valid JSON object with the following fields:
- "title": string (Korean, concise task title)
- "description": string (Korean, detailed summary)
- "due_date": string (YYYY-MM-DD, if multiple use earliest, if none use "")
- "requester": string (Korean, who requested it. e.g. "본부", "팀장", "지자체". If unknown, use "파악 불가")
- "ai_execution_plan": string (Korean, step-by-step action plan on how to efficiently execute this task, leveraging the Company Background provided. At least 3 detailed steps.)
- "priority": string (Korean, one of "상", "중", "하". Decide this based on urgency and the provided "Current Pending Tasks" load.)
- "full_text": string (Only if requested, otherwise empty string)

If year is missing in source, assume 2026. Do NOT wrap in markdown code blocks, return raw JSON string.`;
  };

  const saveTasksToFirestore = async (extractedData: any, source: string, sourceContent: string) => {
    const batch = writeBatch(db);
    const taskRef = doc(collection(db, 'tasks'));
    batch.set(taskRef, {
      title: extractedData.title || '제목 없음',
      description: extractedData.description || '',
      due_date: extractedData.due_date || '',
      requester: extractedData.requester || '파악 불가',
      ai_execution_plan: extractedData.ai_execution_plan || '',
      priority: extractedData.priority || '중',
      status: 'pending',
      source: source,
      source_content: sourceContent,
      created_at: Timestamp.now(),
      assignee: '',
      is_guide_confirmed: false,
      comments: []
    });
    await batch.commit();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !isAdminMode) return;
    setIsUploading(true);
    const file = e.target.files[0];

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [{ 
              parts: [
                { text: generateAIPrompt() },
                { inlineData: { mimeType: file.type || 'application/pdf', data: base64 } }
              ] 
            }],
            config: { responseMimeType: 'application/json' }
          });
          const extractedData = JSON.parse(response.text || '{}');
          if (extractedData.title) {
            await saveTasksToFirestore(extractedData, 'pdf_upload', extractedData.full_text || '문서 텍스트');
          }
        } catch (err) { console.error('Gemini processing failed', err); } 
        finally { setIsUploading(false); }
      };
      reader.readAsDataURL(file);
    } catch (err) { setIsUploading(false); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !isAdminMode) return;
    setIsProcessingImage(true);
    const file = e.target.files[0];

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = file.type;
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [{
              parts: [
                { text: generateAIPrompt() },
                { inlineData: { mimeType: mimeType, data: base64 } }
              ]
            }],
            config: { responseMimeType: 'application/json' }
          });
          const extractedData = JSON.parse(response.text || '{}');
          if (extractedData.title) {
            await saveTasksToFirestore(extractedData, 'image_upload', `data:${mimeType};base64,${base64}`);
          }
        } catch (err) { console.error('Gemini processing failed', err); } 
        finally { setIsProcessingImage(false); }
      };
      reader.readAsDataURL(file);
    } catch (err) { setIsProcessingImage(false); }
  };

  const handleTextExtract = async () => {
    if (!rawText.trim() || !isAdminMode) return;
    setIsProcessingText(true);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: `${generateAIPrompt()}\n\nSource Text:\n${rawText}` }] }],
        config: { responseMimeType: 'application/json' }
      });
      const extractedData = JSON.parse(response.text || '{}');
      if (extractedData.title) {
        await saveTasksToFirestore(extractedData, 'text_input', rawText);
      }
      setRawText('');
      setShowTextInput(false);
    } catch (err) { console.error('Text extraction failed', err); } 
    finally { setIsProcessingText(false); }
  };

  const filteredTasks = tasks.filter(task => {
    if (activeTab === 'pending') return task.status === 'pending';
    if (activeTab === 'completed') return task.status === 'completed';
    if (activeTab === 'team') return task.assignee && task.assignee.trim() !== '';
    return true;
  }).sort((a, b) => {
    // Priority sorting mapping: 상 -> 3, 중 -> 2, 하 -> 1
    const pA = a.priority === '상' ? 3 : a.priority === '중' ? 2 : 1;
    const pB = b.priority === '상' ? 3 : b.priority === '중' ? 2 : 1;
    if (activeTab === 'pending') {
      if (pA !== pB) return pB - pA; // Higher priority first
    }
    // Fallback to due date
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const getPriorityColor = (priority?: string) => {
    if (priority === '상') return 'bg-red-500 text-white border-red-500';
    if (priority === '중') return 'bg-amber-500 text-white border-amber-500';
    if (priority === '하') return 'bg-blue-500 text-white border-blue-500';
    return 'bg-gray-300 text-black border-gray-300';
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={() => setIsSidebarOpen(false)} 
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#E4E3E0] border-r border-[#141414] transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col p-6 space-y-8 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-[#141414] rounded-sm flex items-center justify-center">
              <LayoutDashboard className="text-[#E4E3E0] w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tighter italic serif">TaskFlow AI</h1>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setActiveTab('pending')}
            className={`w-full text-left px-4 py-2 rounded-sm transition-colors flex items-center justify-between ${activeTab === 'pending' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <span className="text-sm font-medium uppercase tracking-wider">진행 중인 업무</span>
            <ChevronRight className="w-4 h-4 opacity-50" />
          </button>
          <button 
            onClick={() => setActiveTab('team')}
            className={`w-full text-left px-4 py-2 rounded-sm transition-colors flex items-center justify-between ${activeTab === 'team' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <span className="text-sm font-medium uppercase tracking-wider">팀원별 보기</span>
            <ChevronRight className="w-4 h-4 opacity-50" />
          </button>
          <button 
            onClick={() => setActiveTab('completed')}
            className={`w-full text-left px-4 py-2 rounded-sm transition-colors flex items-center justify-between ${activeTab === 'completed' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <span className="text-sm font-medium uppercase tracking-wider">완료된 업무</span>
            <ChevronRight className="w-4 h-4 opacity-50" />
          </button>
        </nav>

        {/* Admin Tools - Only visible in Admin Mode */}
        {isAdminMode && (
          <div className="space-y-4 pt-8 border-t border-[#141414]/10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/50 mb-2">업무 입력 (관리자)</p>
            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="w-10 h-10 border border-[#141414] flex items-center justify-center group-hover:bg-[#141414] group-hover:text-[#E4E3E0] transition-colors">
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest">PDF 문서</p>
              </div>
              <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} disabled={isUploading} />
            </label>

            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="w-10 h-10 border border-[#141414] flex items-center justify-center group-hover:bg-[#141414] group-hover:text-[#E4E3E0] transition-colors">
                {isProcessingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest">이미지/캡쳐</p>
              </div>
              <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={isProcessingImage} />
            </label>

            <button 
              onClick={() => setShowTextInput(!showTextInput)}
              className="flex items-center space-x-3 cursor-pointer group w-full text-left"
            >
              <div className={`w-10 h-10 border border-[#141414] flex items-center justify-center group-hover:bg-[#141414] group-hover:text-[#E4E3E0] transition-colors ${showTextInput ? 'bg-[#141414] text-[#E4E3E0]' : ''}`}>
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest">텍스트 직접 입력</p>
              </div>
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0 overflow-hidden">
        <header className="h-16 md:h-20 border-b border-[#141414] flex items-center justify-between px-4 md:px-8 shrink-0 bg-[#E4E3E0] z-10">
          <div className="flex items-center space-x-2 md:space-x-4 min-w-0">
            <button 
              className="md:hidden p-2 hover:bg-[#141414]/5 rounded-sm"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg md:text-2xl font-serif italic truncate">
              {activeTab === 'pending' ? '진행 중인 업무' : activeTab === 'completed' ? '완료된 업무' : '팀원별 보기'}
            </h2>
            <span className="text-xs font-mono opacity-50 hidden sm:inline-block">[{filteredTasks.length}]</span>
          </div>
          
          {/* View Mode Toggle */}
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`flex items-center space-x-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${isAdminMode ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'bg-transparent border-[#141414]/20 hover:border-[#141414]'}`}
            >
              {isAdminMode ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4 opacity-50" />}
              <span className="hidden sm:inline">{isAdminMode ? '관리자 모드' : '뷰어 모드'}</span>
            </button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          <AnimatePresence>
            {showTextInput && isAdminMode && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-8 p-6 bg-white border border-[#141414] shadow-xl"
              >
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-bold uppercase tracking-widest">이메일, 회의록 등 텍스트 기반 업무 추출</h4>
                  <button onClick={() => setShowTextInput(false)}><X className="w-4 h-4" /></button>
                </div>
                <textarea 
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="텍스트를 여기에 붙여넣으세요..."
                  className="w-full h-32 bg-[#F5F5F5] border border-[#141414]/10 p-4 text-sm focus:outline-none focus:border-[#141414] transition-colors resize-none mb-4"
                />
                <button 
                  onClick={handleTextExtract}
                  disabled={isProcessingText || !rawText.trim()}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-3 text-xs font-bold uppercase tracking-widest hover:bg-[#141414]/90 transition-colors disabled:opacity-50"
                >
                  {isProcessingText ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'AI 업무 추출 및 일정에 추가'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin opacity-20" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20">
              <Clock className="w-16 h-16 mb-4" />
              <p className="text-xl font-serif italic">목록이 비어 있습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-px bg-[#141414]/10 border border-[#141414]/10">
              {filteredTasks.map((task) => (
                <motion.div 
                  layout
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="bg-[#E4E3E0] p-4 md:p-6 flex items-start sm:items-center group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-200 cursor-pointer relative"
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); toggleTaskStatus(task.id, task.status); }}
                    className={`w-5 h-5 md:w-6 md:h-6 border border-current flex items-center justify-center mr-4 md:mr-6 transition-colors shrink-0 mt-0.5 sm:mt-0 ${task.status === 'completed' ? 'bg-current' : ''}`}
                  >
                    {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 md:w-4 md:h-4 text-[#E4E3E0]" />}
                  </button>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {/* Priority Badge */}
                      {task.status !== 'completed' && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 border ${getPriorityColor(task.priority)}`}>
                          우선순위: {task.priority || '보통'}
                        </span>
                      )}
                      
                      <h3 className={`text-base md:text-lg font-medium tracking-tight truncate ${task.status === 'completed' ? 'line-through opacity-30' : ''}`}>
                        {task.title}
                      </h3>
                      
                      <span className="text-[10px] uppercase border border-current px-1.5 py-0.5 opacity-50 whitespace-nowrap">
                        {task.assignee ? `담당: ${task.assignee}` : '미할당'}
                      </span>
                    </div>
                    
                    <p className={`text-xs md:text-sm opacity-60 line-clamp-1 ${task.status === 'completed' ? 'line-through' : ''}`}>
                      요청자: {task.requester || '파악 불가'} | {task.description}
                    </p>
                    
                    {/* Mobile Only Quick Info */}
                    <div className="mt-2 sm:hidden flex items-center justify-between">
                      <p className="text-[10px] font-mono opacity-70">마감: {task.due_date || '미정'}</p>
                      {isAdminMode && (
                        <button onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="p-1 text-red-500 rounded-sm">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-right hidden sm:flex items-center space-x-4 md:space-x-6 shrink-0 ml-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-1">마감일</p>
                      <p className="text-xs font-mono">{task.due_date || '미정'}</p>
                    </div>
                    {isAdminMode && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                        className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500 hover:text-white transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Task Detail Modal */}
        <AnimatePresence>
          {selectedTask && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 md:p-8"
              onClick={() => setSelectedTask(null)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-[#E4E3E0] w-full max-w-4xl border border-[#141414] shadow-2xl flex flex-col max-h-[90vh] md:max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="p-4 md:p-6 border-b border-[#141414] flex items-center justify-between shrink-0 bg-white/50">
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 border ${getPriorityColor(selectedTask.priority)}`}>
                        {selectedTask.priority || '보통'}
                      </span>
                      <span className="text-[10px] font-mono uppercase border border-[#141414]/30 px-1.5 py-0.5 opacity-60">
                        {selectedTask.status === 'completed' ? '완료됨' : '대기중'}
                      </span>
                    </div>
                    <h3 className="text-xl md:text-2xl font-serif italic truncate">{selectedTask.title}</h3>
                  </div>
                  <button onClick={() => setSelectedTask(null)} className="p-2 hover:bg-[#141414]/5 shrink-0">
                    <X className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                </div>
                
                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#141414]/20">
                  
                  {/* Left Column: Task Info & AI Guide */}
                  <div className="p-4 md:p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1">요청자</p>
                        <p className="text-sm font-medium">{selectedTask.requester || '파악 불가'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1">마감일</p>
                        <p className="text-sm font-mono">{selectedTask.due_date || '미정'}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1">업무 설명</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedTask.description}</p>
                    </div>

                    {/* AI Guide Section */}
                    <div className="bg-[#141414]/5 p-4 border border-[#141414]/10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest flex items-center text-indigo-700">
                          <ShieldAlert className="w-3 h-3 mr-1" /> AI 업무 수행 가이드
                        </p>
                        {!selectedTask.is_guide_confirmed && (
                          <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 font-bold">검수 대기중</span>
                        )}
                      </div>
                      
                      {isAdminMode && !selectedTask.is_guide_confirmed ? (
                        <div className="space-y-3">
                          <textarea 
                            className="w-full h-32 bg-white border border-[#141414]/20 p-2 text-xs font-mono resize-none focus:outline-none"
                            value={selectedTask.ai_execution_plan || ''}
                            onChange={(e) => updateGuideText(e.target.value)}
                          />
                          <button 
                            onClick={confirmGuide}
                            className="w-full bg-[#141414] text-[#E4E3E0] py-2 text-xs font-bold uppercase tracking-widest hover:bg-[#141414]/90"
                          >
                            가이드 확정하기 (팀원에게 노출)
                          </button>
                        </div>
                      ) : (!selectedTask.is_guide_confirmed && !isAdminMode) ? (
                        <p className="text-xs opacity-50 italic">팀장님이 가이드를 검수 중입니다...</p>
                      ) : (
                        <div className="text-xs leading-relaxed whitespace-pre-wrap font-medium">
                          {selectedTask.ai_execution_plan}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Assignments & Comments */}
                  <div className="p-4 md:p-6 space-y-6 flex flex-col">
                    
                    {/* Assignment */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2">담당 팀원 할당</p>
                      {isAdminMode ? (
                        <input 
                          type="text"
                          placeholder="팀원 이름 입력..."
                          className="w-full bg-transparent border-b border-[#141414]/30 py-2 text-sm focus:outline-none focus:border-[#141414] transition-colors"
                          value={selectedTask.assignee || ''}
                          onChange={(e) => updateAssignee(e.target.value)}
                        />
                      ) : (
                        <div className="flex items-center space-x-2 bg-white/50 p-2 border border-[#141414]/10">
                          <UserCircle2 className="w-5 h-5 opacity-50" />
                          <span className="text-sm font-bold">{selectedTask.assignee || '아직 할당되지 않았습니다'}</span>
                        </div>
                      )}
                    </div>

                    {/* Comments Section */}
                    <div className="flex-1 flex flex-col min-h-[250px]">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-3">진행 상황 & 코멘트</p>
                      
                      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                        {(!selectedTask.comments || selectedTask.comments.length === 0) ? (
                          <p className="text-xs opacity-40 text-center py-8">아직 코멘트가 없습니다.</p>
                        ) : (
                          selectedTask.comments.map((comment, idx) => (
                            <div key={idx} className="bg-white/70 p-3 border border-[#141414]/10 rounded-sm">
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-xs font-bold ${comment.author === '관리자' ? 'text-indigo-700' : 'text-[#141414]'}`}>{comment.author}</span>
                                <span className="text-[10px] font-mono opacity-40">
                                  {comment.createdAt ? new Date(comment.createdAt.seconds * 1000).toLocaleString() : '방금 전'}
                                </span>
                              </div>
                              <p className="text-xs">{comment.text}</p>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Comment Input */}
                      <div className="border border-[#141414]/20 bg-white p-2">
                        {!isAdminMode && (
                          <input 
                            type="text" 
                            placeholder="작성자 이름 (예: 홍길동 대리)" 
                            className="w-full bg-transparent text-xs font-bold mb-2 pb-1 border-b border-[#141414]/10 focus:outline-none"
                            value={commentAuthor}
                            onChange={(e) => setCommentAuthor(e.target.value)}
                          />
                        )}
                        <div className="flex items-center">
                          <input 
                            type="text"
                            placeholder="코멘트를 남겨주세요..."
                            className="flex-1 bg-transparent text-sm focus:outline-none"
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addComment()}
                          />
                          <button onClick={addComment} className="p-2 bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 shrink-0">
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
