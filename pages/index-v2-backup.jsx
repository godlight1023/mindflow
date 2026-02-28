import { useState, useEffect, useRef } from 'react';

// ══════════════════════════════════════════════════════════════
// MindFlow v2.0 - AI 任务提取版本
// ══════════════════════════════════════════════════════════════

// 任务分类配置
const CATEGORIES = {
  work: { label: '工作', color: '#3b82f6', icon: '💼' },
  study: { label: '学习', color: '#8b5cf6', icon: '📚' },
  life: { label: '生活', color: '#10b981', icon: '🏠' }
};

// AI 系统提示词
function buildSystemPrompt() {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  
  return `你是 MindFlow AI 秘书。当前时间：${date} ${time}。

分析用户输入，提取任务信息：
1. 识别任务（动词开头）
2. 分类：work（工作）/study（学习）/life（生活）
3. 预估时长（15-120分钟）
4. 提取时间点（转为 HH:MM 格式）

返回 JSON（不含 Markdown）：
{
  "summary": "简短确认语（20字内）",
  "tasks": [
    {
      "id": "ai_1",
      "title": "任务标题",
      "category": "work",
      "duration": 30,
      "startTime": "14:00"
    }
  ]
}

无任务时返回：{"summary": "好的，有什么需要帮忙的吗？", "tasks": []}`;
}

// AI API 调用
async function callAI(userInput) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: buildSystemPrompt(),
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

// 解析 AI 响应
function parseAIResponse(raw) {
  try {
    // 移除可能的 markdown 代码块标记
    let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // 尝试提取 JSON
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
    
    const parsed = JSON.parse(cleaned);
    
    return {
      summary: parsed.summary || '任务已识别',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((t, i) => ({
        id: t.id || `ai_${Date.now()}_${i}`,
        title: t.title || '未命名任务',
        category: ['work', 'study', 'life'].includes(t.category) ? t.category : 'work',
        duration: typeof t.duration === 'number' ? t.duration : 30,
        startTime: t.startTime || null,
        done: false,
        subtasks: []
      })) : []
    };
  } catch (error) {
    console.error('Parse error:', error);
    return { summary: '识别失败', tasks: [] };
  }
}

// ══════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════

export default function MindFlow() {
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);

  // 发送消息给 AI
  const handleSend = async () => {
    if (!input.trim() || thinking) return;

    const userMessage = input.trim();
    setInput('');
    setThinking(true);

    // 添加用户消息
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      text: userMessage,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }]);

    try {
      // 调用 AI
      const result = await callAI(userMessage);

      if (result && result.tasks.length > 0) {
        // 添加 AI 响应和任务建议
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'ai',
          text: result.summary,
          tasks: result.tasks,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        // 无任务时的响应
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'ai',
          text: result?.summary || '我没有识别到具体任务，能再详细说说吗？',
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'ai',
        text: '抱歉，我遇到了一些问题。请稍后再试。',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  };

  // 确认任务
  const confirmTasks = (messageTasks) => {
    setTasks(prev => [...prev, ...messageTasks]);
  };

  // 切换任务完成状态
  const toggleTask = (id) => {
    setTasks(prev => prev.map(t => 
      t.id === id ? { ...t, done: !t.done } : t
    ));
  };

  // 删除任务
  const deleteTask = (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // 统计
  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.done).length,
    pending: tasks.filter(t => !t.done).length
  };

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
          borderBottom: '1px solid rgba(99,179,237,0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '12px'
          }}>
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
                AI 私人秘书 v2.0
              </p>
            </div>
          </div>
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
                  // 用户消息
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
                  // AI 消息
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

                      {/* AI 识别的任务 */}
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
                                </div>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => confirmTasks(msg.tasks)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              marginTop: '8px',
                              background: 'linear-gradient(135deg, #10b981, #059669)',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#fff',
                              fontSize: '13px',
                              fontWeight: '600',
                              cursor: 'pointer'
                            }}
                          >
                            ✓ 确认添加到任务列表
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {/* 思考中动画 */}
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
        padding: '32px'
      }}>
        {/* 统计 */}
        <div style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px'
        }}>
          {[
            { label: '总任务', value: stats.total, color: '#3b82f6' },
            { label: '已完成', value: stats.done, color: '#10b981' },
            { label: '进行中', value: stats.pending, color: '#f59e0b' }
          ].map((stat, i) => (
            <div key={i} style={{
              flex: 1,
              padding: '20px',
              background: 'rgba(13,20,38,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '12px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '28px',
                fontWeight: '700',
                color: stat.color,
                marginBottom: '4px'
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '13px',
                color: '#94a3b8'
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* 任务列表 */}
        <div style={{
          background: 'rgba(13,20,38,0.6)',
          border: '1px solid rgba(99,179,237,0.1)',
          borderRadius: '16px',
          padding: '24px',
          flex: 1,
          overflowY: 'auto'
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
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      transition: 'all 0.2s'
                    }}
                  >
                    {/* 完成按钮 */}
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

                    {/* 任务内容 */}
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
                        color: '#64748b'
                      }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: `${cat.color}20`,
                          color: cat.color
                        }}>
                          {cat.label}
                        </span>
                        <span>⏱ {task.duration}分钟</span>
                        {task.startTime && <span>🕐 {task.startTime}</span>}
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={() => deleteTask(task.id)}
                      style={{
                        padding: '6px 10px',
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: '6px',
                        color: '#ef4444',
                        fontSize: '12px',
                        cursor: 'pointer',
                        flexShrink: 0
                      }}
                    >
                      删除
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 样式 */}
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}