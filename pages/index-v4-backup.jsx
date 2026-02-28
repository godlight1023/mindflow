import { useState, useEffect, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import UserProfile from '../components/UserProfile';

// ═══════════════════════════════════════════════════════════════════
// MindFlow v4.0 - 完整版
// 功能：用户认证 + AI任务提取 + 专注模式 + 任务拆解 + 打卡日历
// ═══════════════════════════════════════════════════════════════════

// ── 配置常量 ──────────────────────────────────────────────────────
const CATEGORIES = {
  work: { label: '工作', color: '#3b82f6', icon: '💼' },
  study: { label: '学习', color: '#8b5cf6', icon: '📚' },
  life: { label: '生活', color: '#10b981', icon: '🏠' }
};

const STORAGE_KEY = 'mindflow_v4';
const TODAY = new Date().toISOString().slice(0, 10);

// ── 本地存储 ──────────────────────────────────────────────────────
function loadData() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Save failed:', e);
  }
}

// ── AI 提示词 ──────────────────────────────────────────────────────
function buildSystemPrompt() {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  
  return `你是 MindFlow AI 秘书。

**重要时间信息**：
- 今天是：${date} ${time}
- 明天是：${tomorrowDate}

**任务提取规则**：
1. **时间识别**：
   - "明天" = 明天的日期
   - "今天" = 今天的日期
   - "后天" = 后天的日期

2. **任务分类**：
   - work（工作）：开会、写报告、项目
   - study（学习）：学习、看书、上课
   - life（生活）：健身、购物、做饭

3. **时长预估**：默认 30-60 分钟

4. **时间点转换**：
   - 上午 = 09:00
   - 下午 = 14:00
   - 晚上 = 19:00

返回 JSON（无 Markdown）：
{
  "summary": "确认语（20字内）",
  "tasks": [
    {
      "id": "ai_1",
      "title": "任务标题",
      "category": "work",
      "duration": 30,
      "startTime": "14:00",
      "date": "today" 或 "tomorrow"
    }
  ]
}`;
}

function buildBreakdownPrompt(title, duration) {
  return `将任务「${title}」（${duration}分钟）拆解为 3-5 个可执行步骤。

要求：
- 每步骤 ≤ 20 分钟
- 动词开头（打开/列出/写下）

返回 JSON：
[
  {"id": "s_1", "text": "动作描述", "est": 15, "done": false}
]`;
}

// ── AI API 调用 ──────────────────────────────────────────────────
async function callAI(userInput, promptBuilder) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: promptBuilder(),
        message: userInput
      })
    });

    if (!response.ok) {
      throw new Error('API 调用失败');
    }

    const data = await response.json();
    return parseAIResponse(data.response);
  } catch (error) {
    console.error('AI Error:', error);
    return null;
  }
}

function parseAIResponse(raw) {
  try {
    let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) cleaned = jsonMatch[0];
    
    const parsed = JSON.parse(cleaned);
    
    if (parsed.tasks) {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().slice(0, 10);
      
      return {
        summary: parsed.summary || '任务已识别',
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((t, i) => {
          let taskDate = today;
          if (t.date === 'tomorrow') {
            taskDate = tomorrowDate;
          } else if (t.date === 'today') {
            taskDate = today;
          }
          
          return {
            id: t.id || `ai_${Date.now()}_${i}`,
            title: t.title || '未命名任务',
            category: ['work', 'study', 'life'].includes(t.category) ? t.category : 'work',
            duration: typeof t.duration === 'number' ? t.duration : 30,
            startTime: t.startTime || null,
            date: taskDate,
            done: false,
            subtasks: []
          };
        }) : []
      };
    }
    
    if (Array.isArray(parsed)) {
      return parsed.map((s, i) => ({
        id: s.id || `s_${i}`,
        text: s.text || '步骤',
        est: s.est || 15,
        done: s.done || false
      }));
    }
    
    return parsed;
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

// ── 日期格式化 ────────────────────────────────────────────────────
function formatDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  
  if (dateStr === today) return '今天';
  if (dateStr === tomorrowDate) return '明天';
  
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// ═══════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════

export default function MindFlow() {
  const { data: session, status } = useSession();
  const loading = status === 'loading';

  useEffect(() => {
    if (!loading && !session) {
      signIn();
    }
  }, [loading, session]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #040810 0%, #0d1426 100%)',
        color: '#f1f5f9',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            border: '3px solid rgba(99,179,237,0.2)',
            borderTop: '3px solid #2563eb',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <p>加载中...</p>
        </div>
        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return <MindFlowApp />;
}

// ═══════════════════════════════════════════════════════════════════
// MindFlow 主应用
// ═══════════════════════════════════════════════════════════════════

function MindFlowApp() {
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [focusTask, setFocusTask] = useState(null);
  const [focusTime, setFocusTime] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [calendar, setCalendar] = useState([]);
  
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // 初始化加载数据
  useEffect(() => {
    const saved = loadData();
    if (saved && saved.date === TODAY) {
      setTasks(saved.tasks || []);
      setMessages(saved.messages || []);
    }
    loadCalendar();
  }, []);

  // 自动保存
  useEffect(() => {
    if (tasks.length > 0 || messages.length > 0) {
      saveData({
        date: TODAY,
        tasks,
        messages,
        timestamp: Date.now()
      });
    }
  }, [tasks, messages]);

  // 专注模式计时器
  useEffect(() => {
    if (!isPaused && focusTask) {
      timerRef.current = setInterval(() => {
        setFocusTime(t => {
          if (t >= focusTask.duration * 60) {
            setIsPaused(true);
            completeFocusTask();
            return 0;
          }
          return t + 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, focusTask]);

  // 加载打卡日历
  function loadCalendar() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      
      const dayData = loadData();
      const completed = dayData?.date === dateStr 
        ? dayData.tasks?.filter(t => t.done).length || 0
        : 0;
      
      days.push({
        date: dateStr,
        day: date.getDate(),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
        completed,
        isToday: dateStr === TODAY
      });
    }
    setCalendar(days);
  }

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || thinking) return;

    const userMessage = input.trim();
    setInput('');
    setThinking(true);

    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      text: userMessage,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }]);

    try {
      const result = await callAI(userMessage, buildSystemPrompt);

      console.log('AI 返回结果:', result); 

      if (result && result.tasks && result.tasks.length > 0) {
        console.log('识别到的任务:', result.tasks);

        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'ai',
          text: result.summary,
          tasks: result.tasks,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'ai',
          text: result?.summary || '我没有识别到具体任务',
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'ai',
        text: '抱歉，遇到了一些问题',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  };

const confirmTasks = (messageId, messageTasks) => {
  console.log('确认添加任务:', { messageId, messageTasks }); 

  // 验证输入
  if (!messageTasks || !Array.isArray(messageTasks)) {
    console.error('无效的任务数据');
    return;
  }
  if (messageTasks.length === 0) {
    console.log('没有任务需要添加');
    return;
  }

 setTasks(prev => {
    const newTasks = [...prev, ...messageTasks];
    console.log('任务已添加，当前任务数:', newTasks.length);
    return newTasks;
  });
  
  // 标记该消息的任务已添加
  setMessages(prev => prev.map(msg => 
    msg.id === messageId ? { ...msg, tasksAdded: true } : msg
  ));
};

  const breakdownTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.subtasks?.length > 0) return;

    try {
      const result = await callAI(
        task.title,
        () => buildBreakdownPrompt(task.title, task.duration)
      );

      if (result && Array.isArray(result)) {
        setTasks(prev => prev.map(t => 
          t.id === taskId ? { ...t, subtasks: result } : t
        ));
      }
    } catch (error) {
      console.error('Breakdown failed:', error);
    }
  };

  const toggleTask = (id) => {
    setTasks(prev => prev.map(t => 
      t.id === id ? { ...t, done: !t.done } : t
    ));
  };

  const toggleSubtask = (taskId, subtaskId) => {
    setTasks(prev => prev.map(t => 
      t.id === taskId ? {
        ...t,
        subtasks: t.subtasks.map(s => 
          s.id === subtaskId ? { ...s, done: !s.done } : s
        )
      } : t
    ));
  };

  const deleteTask = (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const startFocus = (task) => {
    setFocusTask(task);
    setFocusTime(0);
    setIsPaused(true);
  };

  const completeFocusTask = () => {
    if (focusTask) {
      toggleTask(focusTask.id);
      setFocusTask(null);
      setFocusTime(0);
      loadCalendar();
    }
  };

  const exitFocus = () => {
    setFocusTask(null);
    setFocusTime(0);
    setIsPaused(true);
  };

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.done).length,
    pending: tasks.filter(t => !t.done).length,
    focusMinutes: Math.floor(tasks.filter(t => t.done).reduce((sum, t) => sum + t.duration, 0))
  };

  const streak = calendar.filter(d => d.completed > 0).length;

  // 专注模式界面
  if (focusTask) {
    const progress = (focusTime / (focusTask.duration * 60)) * 100;
    const remainSeconds = focusTask.duration * 60 - focusTime;
    const mins = Math.floor(remainSeconds / 60);
    const secs = remainSeconds % 60;

    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #040810 0%, #0d1426 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: 'relative'
      }}>
        <button
          onClick={exitFocus}
          style={{
            position: 'absolute',
            top: '24px',
            left: '24px',
            padding: '10px 20px',
            background: 'rgba(99,179,237,0.1)',
            border: '1px solid rgba(99,179,237,0.2)',
            borderRadius: '10px',
            color: '#93c5fd',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          ← 返回
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <svg width="320" height="320" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="160"
                cy="160"
                r="140"
                fill="none"
                stroke="rgba(99,179,237,0.1)"
                strokeWidth="12"
              />
              <circle
                cx="160"
                cy="160"
                r="140"
                fill="none"
                stroke="url(#gradient)"
                strokeWidth="12"
                strokeDasharray={`${2 * Math.PI * 140}`}
                strokeDashoffset={`${2 * Math.PI * 140 * (1 - progress / 100)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>

            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: '56px',
              fontWeight: '700',
              color: '#f1f5f9'
            }}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
          </div>

          <h2 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: '#e2e8f0',
            margin: '32px 0 8px'
          }}>
            {focusTask.title}
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#64748b',
            margin: '0 0 32px'
          }}>
            {CATEGORIES[focusTask.category].icon} {CATEGORIES[focusTask.category].label} · {focusTask.duration} 分钟
          </p>

          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <button
              onClick={() => setIsPaused(!isPaused)}
              style={{
                padding: '14px 32px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#fff',
                background: isPaused 
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(37,99,235,0.4)'
              }}
            >
              {isPaused ? '▶ 开始' : '⏸ 暂停'}
            </button>

            <button
              onClick={completeFocusTask}
              style={{
                padding: '14px 32px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#fff',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer'
              }}
            >
              ✓ 完成
            </button>
          </div>

          {focusTask.subtasks?.length > 0 && (
            <div style={{
              marginTop: '48px',
              background: 'rgba(13,20,38,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '500px',
              margin: '48px auto 0'
            }}>
              <h3 style={{
                fontSize: '14px',
                color: '#94a3b8',
                marginBottom: '16px',
                textAlign: 'left'
              }}>
                执行步骤
              </h3>
              {focusTask.subtasks.map((sub, i) => (
                <div
                  key={sub.id}
                  onClick={() => toggleSubtask(focusTask.id, sub.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: sub.done ? 'rgba(16,185,129,0.1)' : 'transparent',
                    border: '1px solid rgba(99,179,237,0.1)',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: sub.done ? '2px solid #10b981' : '2px solid rgba(99,179,237,0.4)',
                    background: sub.done ? '#10b981' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff',
                    flexShrink: 0
                  }}>
                    {sub.done && '✓'}
                  </div>
                  <span style={{
                    fontSize: '14px',
                    color: sub.done ? '#94a3b8' : '#e2e8f0',
                    textDecoration: sub.done ? 'line-through' : 'none'
                  }}>
                    {i + 1}. {sub.text}
                  </span>
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: '12px',
                    color: '#64748b'
                  }}>
                    {sub.est}分钟
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 主界面
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #040810 0%, #0d1426 100%)',
      display: 'flex',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      {/* 左侧：AI 对话 */}
      <div style={{
        width: '400px',
        borderRight: '1px solid rgba(99,179,237,0.1)',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(4,8,16,0.4)'
      }}>
        {/* 头部 */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid rgba(99,179,237,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              boxShadow: '0 8px 24px rgba(37,99,235,0.4)'
            }}>
              ✦
            </div>
            <div>
              <h1 style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#f1f5f9',
                margin: '0 0 4px'
              }}>
                MindFlow
              </h1>
              <p style={{
                fontSize: '13px',
                color: '#64748b',
                margin: 0
              }}>
                AI 私人秘书 v4.0
              </p>
            </div>
          </div>
          <UserProfile />
        </div>

        {/* 消息列表 */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px'
        }}>
          {messages.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#64748b'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
              <p style={{ margin: '0 0 8px', fontSize: '15px' }}>
                告诉我你今天要做什么
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
                我会帮你整理成任务清单
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: '16px' }}>
                {msg.role === 'user' ? (
                  <div style={{
                    background: 'rgba(37,99,235,0.1)',
                    border: '1px solid rgba(37,99,235,0.2)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    marginLeft: '40px'
                  }}>
                    <div style={{
                      fontSize: '13px',
                      color: '#93c5fd',
                      marginBottom: '4px'
                    }}>
                      你 · {msg.time}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: '#e2e8f0',
                      lineHeight: '1.5'
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginRight: '40px' }}>
                    <div style={{
                      background: 'rgba(13,20,38,0.8)',
                      border: '1px solid rgba(99,179,237,0.15)',
                      borderRadius: '12px',
                      padding: '12px 14px'
                    }}>
                      <div style={{
                        fontSize: '13px',
                        color: '#6ee7b7',
                        marginBottom: '4px'
                      }}>
                        AI · {msg.time}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: '#cbd5e1',
                        lineHeight: '1.5',
                        marginBottom: msg.tasks ? '12px' : 0
                      }}>
                        {msg.text}
                      </div>

                      {msg.tasks && msg.tasks.length > 0 && (
                        <div>
                          <div style={{
                            fontSize: '12px',
                            color: '#94a3b8',
                            marginBottom: '8px'
                          }}>
                            识别到 {msg.tasks.length} 个任务：
                          </div>
                          {msg.tasks.map((task, i) => {
                            const cat = CATEGORIES[task.category];
                            return (
                              <div key={i} style={{
                                padding: '8px 10px',
                                background: 'rgba(99,179,237,0.05)',
                                border: '1px solid rgba(99,179,237,0.1)',
                                borderRadius: '8px',
                                marginBottom: '6px',
                                fontSize: '13px'
                              }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  marginBottom: '4px'
                                }}>
                                  <span>{cat.icon}</span>
                                  <span style={{ color: '#e2e8f0', fontWeight: '500' }}>
                                    {task.title}
                                  </span>
                                </div>
                                <div style={{
                                  fontSize: '11px',
                                  color: '#64748b',
                                  display: 'flex',
                                  gap: '12px'
                                }}>
                                  <span>{cat.label}</span>
                                  <span>⏱ {task.duration}分钟</span>
                                  {task.startTime && <span>🕐 {task.startTime}</span>}
                                  {task.date && <span>📅 {formatDate(task.date)}</span>}
                                </div>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => confirmTasks(msg.id, msg.tasks)}
                            disabled={msg.tasksAdded}  // ← 添加这行
                            style={{
                              width: '100%',
                              padding: '8px',
                              marginTop: '8px',
                              background: msg.tasksAdded   // ← 修改这里
                                  ? 'rgba(99,179,237,0.2)'
                                  : 'linear-gradient(135deg, #10b981, #059669)',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#fff',
                              fontSize: '13px',
                              fontWeight: '600',
                              cursor: msg.tasksAdded ? 'not-allowed' : 'pointer',
                              opacity: msg.tasksAdded ? 0.6 : 1,  // ← 添加这行
                              transition: 'all 0.3s'
                            }}
                          >
                            <span>{msg.tasksAdded ? '√ 已添加' : '√ 确认添加'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {thinking && (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(13,20,38,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '12px',
              marginRight: '40px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#64748b',
              fontSize: '13px'
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid rgba(99,179,237,0.3)',
                borderTopColor: '#3b82f6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              AI 正在思考...
            </div>
          )}
        </div>

        {/* 输入框 */}
        <div style={{
          padding: '16px',
          borderTop: '1px solid rgba(99,179,237,0.1)'
        }}>
          <div style={{
            display: 'flex',
            gap: '8px',
            background: 'rgba(13,20,38,0.8)',
            border: '1px solid rgba(99,179,237,0.15)',
            borderRadius: '12px',
            padding: '8px'
          }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="告诉我今天要做什么..."
              disabled={thinking}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e2e8f0',
                fontSize: '14px',
                padding: '6px 8px'
              }}
            />
            <button
              onClick={handleSend}
              disabled={thinking || !input.trim()}
              style={{
                padding: '8px 20px',
                background: thinking || !input.trim()
                  ? 'rgba(99,179,237,0.2)'
                  : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: '600',
                cursor: thinking || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: thinking || !input.trim() ? 0.5 : 1
              }}
            >
              {thinking ? '...' : '发送'}
            </button>
          </div>
        </div>
      </div>

      {/* 右侧：任务列表 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '32px',
        overflowY: 'auto'
      }}>
        {/* 统计卡片 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '24px'
        }}>
          {[
            { label: '总任务', value: stats.total, color: '#3b82f6', icon: '📋' },
            { label: '已完成', value: stats.done, color: '#10b981', icon: '✓' },
            { label: '进行中', value: stats.pending, color: '#f59e0b', icon: '⏳' },
            { label: '专注时长', value: `${stats.focusMinutes}分`, color: '#8b5cf6', icon: '🎯' }
          ].map((stat, i) => (
            <div key={i} style={{
              padding: '20px',
              background: 'rgba(13,20,38,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '12px'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>
                {stat.icon}
              </div>
              <div style={{
                fontSize: '24px',
                fontWeight: '700',
                color: stat.color,
                marginBottom: '4px'
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* 打卡日历 */}
        <div style={{
          padding: '20px',
          background: 'rgba(13,20,38,0.6)',
          border: '1px solid rgba(99,179,237,0.1)',
          borderRadius: '12px',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#f1f5f9',
              margin: 0
            }}>
              📅 本周打卡
            </h3>
            <div style={{ fontSize: '13px', color: '#6ee7b7' }}>
              🔥 连续 {streak} 天
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '8px'
          }}>
            {calendar.map((day) => (
              <div
                key={day.date}
                style={{
                  padding: '12px 8px',
                  background: day.completed > 0 
                    ? 'rgba(16,185,129,0.1)' 
                    : 'rgba(99,179,237,0.05)',
                  border: day.isToday
                    ? '2px solid rgba(16,185,129,0.5)'
                    : '1px solid rgba(99,179,237,0.1)',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}
              >
                <div style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  marginBottom: '4px'
                }}>
                  周{day.weekday}
                </div>
                <div style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: day.completed > 0 ? '#10b981' : '#64748b',
                  marginBottom: '4px'
                }}>
                  {day.day}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: day.completed > 0 ? '#6ee7b7' : '#475569'
                }}>
                  {day.completed > 0 ? `✓ ${day.completed}` : '-'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 任务列表 */}
        <div style={{
          background: 'rgba(13,20,38,0.6)',
          border: '1px solid rgba(99,179,237,0.1)',
          borderRadius: '16px',
          padding: '24px',
          flex: 1
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: '600',
            color: '#f1f5f9',
            marginBottom: '20px'
          }}>
            📋 今日任务
          </h2>

          {tasks.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '80px 20px',
              color: '#64748b'
            }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>✦</div>
              <p style={{ fontSize: '16px', margin: '0 0 8px' }}>
                还没有任务
              </p>
              <p style={{ fontSize: '14px', margin: 0, color: '#475569' }}>
                在左侧告诉 AI 你今天要做什么
              </p>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {tasks.map((task) => {
                const cat = CATEGORIES[task.category];
                return (
                  <div
                    key={task.id}
                    style={{
                      padding: '16px',
                      background: task.done
                        ? 'rgba(16,185,129,0.08)'
                        : 'rgba(99,179,237,0.05)',
                      border: task.done
                        ? '1px solid rgba(16,185,129,0.2)'
                        : '1px solid rgba(99,179,237,0.15)',
                      borderRadius: '12px'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      marginBottom: task.subtasks?.length > 0 ? '12px' : 0
                    }}>
                      <button
                        onClick={() => toggleTask(task.id)}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          border: task.done
                            ? '2px solid #10b981'
                            : '2px solid rgba(99,179,237,0.4)',
                          background: task.done ? '#10b981' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: '#fff',
                          fontSize: '12px',
                          flexShrink: 0,
                          marginTop: '2px'
                        }}
                      >
                        {task.done && '✓'}
                      </button>

                      <div style={{ flex: 1 }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '8px'
                        }}>
                          <span style={{ fontSize: '16px' }}>{cat.icon}</span>
                          <span style={{
                            fontSize: '15px',
                            fontWeight: '500',
                            color: task.done ? '#94a3b8' : '#e2e8f0',
                            textDecoration: task.done ? 'line-through' : 'none'
                          }}>
                            {task.title}
                          </span>
                        </div>
                        <div style={{
                          display: 'flex',
                          gap: '12px',
                          fontSize: '12px',
                          color: '#64748b',
                          flexWrap: 'wrap'
                        }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: `${cat.color}20`,
                            color: cat.color
                          }}>
                            {cat.label}
                          </span>
                          {task.date && (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: task.date !== TODAY 
                                ? 'rgba(251,191,36,0.1)' 
                                : 'rgba(99,179,237,0.1)',
                              color: task.date !== TODAY ? '#fbbf24' : '#60a5fa'
                            }}>
                              📅 {formatDate(task.date)}
                            </span>
                          )}
                          <span>⏱ {task.duration}分钟</span>
                          {task.startTime && <span>🕐 {task.startTime}</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        {!task.done && !task.subtasks?.length && (
                          <button
                            onClick={() => breakdownTask(task.id)}
                            style={{
                              padding: '6px 12px',
                              background: 'rgba(139,92,246,0.1)',
                              border: '1px solid rgba(139,92,246,0.2)',
                              borderRadius: '6px',
                              color: '#a78bfa',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            🧩 拆解
                          </button>
                        )}
                        
                        {!task.done && (
                          <button
                            onClick={() => startFocus(task)}
                            style={{
                              padding: '6px 12px',
                              background: 'rgba(37,99,235,0.1)',
                              border: '1px solid rgba(37,99,235,0.2)',
                              borderRadius: '6px',
                              color: '#60a5fa',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            🎯 专注
                          </button>
                        )}

                        <button
                          onClick={() => deleteTask(task.id)}
                          style={{
                            padding: '6px 12px',
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.2)',
                            borderRadius: '6px',
                            color: '#ef4444',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    {/* 子任务列表 */}
                    {task.subtasks?.length > 0 && (
                      <div style={{
                        marginLeft: '36px',
                        paddingLeft: '16px',
                        borderLeft: '2px solid rgba(99,179,237,0.2)'
                      }}>
                        {task.subtasks.map((sub, i) => (
                          <div
                            key={sub.id}
                            onClick={() => toggleSubtask(task.id, sub.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '8px',
                              marginBottom: '4px',
                              cursor: 'pointer',
                              borderRadius: '6px',
                              background: sub.done ? 'rgba(16,185,129,0.05)' : 'transparent'
                            }}
                          >
                            <div style={{
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              border: sub.done ? '2px solid #10b981' : '2px solid rgba(99,179,237,0.3)',
                              background: sub.done ? '#10b981' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              color: '#fff',
                              flexShrink: 0
                            }}>
                              {sub.done && '✓'}
                            </div>
                            <span style={{
                              fontSize: '13px',
                              color: sub.done ? '#94a3b8' : '#cbd5e1',
                              textDecoration: sub.done ? 'line-through' : 'none',
                              flex: 1
                            }}>
                              {i + 1}. {sub.text}
                            </span>
                            <span style={{
                              fontSize: '11px',
                              color: '#64748b'
                            }}>
                              {sub.est}分钟
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 全局样式 */}
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        ::-webkit-scrollbar-track {
          background: rgba(99,179,237,0.05);
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb {
          background: rgba(99,179,237,0.2);
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(99,179,237,0.3);
        }
      `}</style>
    </div>
  );
}