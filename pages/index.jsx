import { useState, useEffect, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import UserProfile from '../components/UserProfile';
import {
  initializeEnergy,
  drainEnergy,
  recoverEnergy,
  calculateRecovery,
  calculateFocusDrain,
  getEnergyData,
  getEnergyStatus
} from '../lib/energySystem';

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

// const STORAGE_KEY = 'mindflow_v4';
const TODAY = new Date().toISOString().slice(0, 10);

// ── 本地存储 ──────────────────────────────────────────────────────
function loadAllData(userId) {
  if (!userId) return {};
  try {
    const ALL_STORAGE_KEY = `mindflow_v4_all_${userId}`;
    const allData = localStorage.getItem(ALL_STORAGE_KEY);
    if (allData) return JSON.parse(allData);
    
    // 尝试迁移旧版本数据
    const OLD_STORAGE_KEY = `mindflow_v4_${userId}`;
    const oldDataStr = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldDataStr) {
      const oldData = JSON.parse(oldDataStr);
      const migrated = { [oldData.date || TODAY]: oldData };
      localStorage.setItem(ALL_STORAGE_KEY, JSON.stringify(migrated));
      // 可选：localStorage.removeItem(OLD_STORAGE_KEY);
      return migrated;
    }
    
    return {};
  } catch {
    return {};
  }
}

function saveDateData(userId, date, data) {
  if (!userId) return;
  try {
    const allData = loadAllData(userId);
    allData[date] = {
      ...data,
      timestamp: Date.now()
    };
    const STORAGE_KEY = `mindflow_v4_all_${userId}`;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
  } catch (e) {
    console.error('Save failed:', e);
  }
}

function loadData(userId) {
  // 兼容旧版本数据加载逻辑，或者作为默认加载今天的逻辑
  const allData = loadAllData(userId);
  return allData[TODAY] || null;
}

function saveData(userId, data) {
  saveDateData(userId, data.date || TODAY, data);
}

// ── AI 提示词 ──────────────────────────────────────────────────────
function buildSystemPrompt(existingTasks = []) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  
  const tasksListStr = existingTasks.length > 0 
    ? `\n**当前已存在的任务列表**（请勿重复提取）：\n${existingTasks.map(t => `- ${t.title} (${t.date} ${t.startTime || ''})`).join('\n')}`
    : '';
  
  return `你是 MindFlow AI 秘书。

**重要时间信息**：
- 今天是：${date} ${time}
- 明天是：${tomorrowDate}${tasksListStr}

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
  {"text": "动作描述", "est": 15, "done": false}
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
          
          const uniqueId = `ai_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
          
          return {
            id: uniqueId,
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
        id: `s_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
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

// ── 提醒检查 ──────────────────────────────────────────────────
function checkReminders(tasks) {
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes(); // 当前分钟数
  
  tasks.forEach(task => {
    if (task.done || !task.startTime || !task.reminder) return;
    
    // 解析开始时间
    const [hours, minutes] = task.startTime.split(':').map(Number);
    const taskTime = hours * 60 + minutes;
    const reminderMinutes = parseInt(task.reminder) || 0;
    const reminderTime = taskTime - reminderMinutes;
    
    // 检查是否该提醒
    if (Math.abs(currentTime - reminderTime) < 1) {
      // 发送通知
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('MindFlow 任务提醒', {
          body: `${task.title}\n将于 ${task.startTime} 开始`,
          icon: '/icons/icon-192x192.png',
          tag: task.id,
          requireInteraction: true
        });
      }
    }
  });
}
// ── 生成重复任务 ──────────────────────────────────────────────
function generateRecurringTasks(task, targetDate) {
  if (task.repeat === 'none' || !task.repeat) return null;
  
  // 核心逻辑：只从“原始”任务生成，不从已生成的实例生成
  // 检查 ID 是否已经是生成出来的格式 (例如 manual_123_2026-02-27)
  if (task.id.includes('_20')) {
    // 这是一个已生成的实例，不应该再基于它生成新的实例
    return null;
  }
  
  const taskDate = new Date(task.date);
  const target = new Date(targetDate);
  
  // 检查是否应该创建重复任务
  let shouldCreate = false;
  
  switch (task.repeat) {
    case 'daily':
      shouldCreate = true;
      break;
    case 'weekdays':
      const day = target.getDay();
      shouldCreate = day >= 1 && day <= 5; // 周一到周五
      break;
    case 'weekly':
      shouldCreate = taskDate.getDay() === target.getDay();
      break;
    case 'monthly':
      shouldCreate = taskDate.getDate() === target.getDate();
      break;
  }
  
  if (shouldCreate && task.date !== targetDate) {
    return {
      ...task,
      id: `${task.id}_${targetDate}`,
      date: targetDate,
      done: false,
      subtasks: task.subtasks ? task.subtasks.map(s => ({ 
        ...s, 
        id: `${s.id}_${targetDate}`, // 为生成的子任务也分配带日期的唯一 ID
        done: false 
      })) : [] // 子任务也重置
    };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// 能量变化提示组件
// ═══════════════════════════════════════════════════════════════════

function EnergyNotification({ type, amount, visible, onClose }) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const isRecovery = type === 'recovery';
  const color = isRecovery ? '#10b981' : '#ef4444';
  const icon = isRecovery ? '💚' : '⚡';
  const text = isRecovery ? '精力恢复' : '精力消耗';

  return (
    <div style={{
      position: 'fixed',
      top: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 24px',
      background: `${color}20`,
      border: `2px solid ${color}`,
      borderRadius: '12px',
      color: color,
      fontSize: '14px',
      fontWeight: '600',
      zIndex: 3000,
      boxShadow: `0 4px 20px ${color}40`,
      animation: 'slideDown 0.3s ease-out',
      backdropFilter: 'blur(10px)'
    }}>
      <span style={{ fontSize: '18px', marginRight: '8px' }}>{icon}</span>
      {text} {isRecovery ? '+' : '-'}{amount.toFixed(1)}%
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 任务编辑模态框组件
// ═══════════════════════════════════════════════════════════════════

function TaskModal({ task, isNew, onSave, onClose, defaultDate = TODAY, isMobile = false }) {
  const [formData, setFormData] = useState({
    title: task?.title || '',
    category: task?.category || 'work',
    duration: task?.duration || 30,
    startTime: task?.startTime || '',
    deadline: task?.deadline || '',
    date: task?.date || defaultDate,
    reminder: task?.reminder || '',
    repeat: task?.repeat || 'none'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      alert('请输入任务名称');
      return;
    }
    onSave(formData);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        background: 'rgba(13,20,38,0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,179,237,0.2)',
        borderRadius: isMobile ? '16px 16px 0 0' : '16px',
        padding: isMobile ? '24px' : '32px',
        maxHeight: isMobile ? '95vh' : '90vh',
        marginTop: isMobile ? 'auto' : '0',
        overflowY: 'auto'
      }}>
        <h2 style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#f1f5f9',
          marginBottom: '24px'
        }}>
          {isNew ? '➕ 添加任务' : '✏️ 编辑任务'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* 任务名称 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              任务名称 *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="例如：完成项目报告"
              autoFocus
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                outline: 'none'
              }}
            />
          </div>

          {/* 分类 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              分类
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormData({ ...formData, category: key })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    fontSize: '13px',
                    color: formData.category === key ? '#fff' : '#94a3b8',
                    background: formData.category === key 
                      ? cat.color 
                      : 'rgba(30,41,59,0.6)',
                    border: `1px solid ${formData.category === key ? cat.color : 'rgba(99,179,237,0.2)'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 时长 */}
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              预计时长（分钟）
            </label>
            <input
              type="number"
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 30 })}
              min="5"
              max="480"
              step="5"
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                outline: 'none'
              }}
            />
          </div>

          {/* 日期 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              日期
            </label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                outline: 'none',
                colorScheme: 'dark'
              }}
            />
          </div>

          {/* 开始时间和截止时间 */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '12px',
            marginBottom: '20px'
          }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#e2e8f0',
                marginBottom: '8px'
              }}>
                开始时间
              </label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '14px',
                  color: '#f1f5f9',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: '10px',
                  outline: 'none',
                  colorScheme: 'dark'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#e2e8f0',
                marginBottom: '8px'
              }}>
                截止时间
              </label>
              <input
                type="time"
                value={formData.deadline}
                onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '14px',
                  color: '#f1f5f9',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: '10px',
                  outline: 'none',
                  colorScheme: 'dark'
                }}
              />
            </div>
          </div>

          {/* 提醒时间 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              提醒时间
            </label>
            <select
              value={formData.reminder}
              onChange={(e) => setFormData({ ...formData, reminder: e.target.value })}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="">不提醒</option>
              <option value="0">任务开始时</option>
              <option value="5">提前 5 分钟</option>
              <option value="10">提前 10 分钟</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
              <option value="60">提前 1 小时</option>
              <option value="1440">提前 1 天</option>
            </select>
          </div>

          {/* 重复设置 */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '500',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              重复
            </label>
            <select
              value={formData.repeat}
              onChange={(e) => setFormData({ ...formData, repeat: e.target.value })}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekdays">工作日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>

          {/* 按钮 */}
          <div style={{ 
            display: 'flex', 
            gap: '12px',
            marginTop: '24px'
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#94a3b8',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '10px',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#fff',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(37,99,235,0.4)'
              }}
            >
              {isNew ? '添加任务' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 子任务编辑模态框
// ═══════════════════════════════════════════════════════════════════

function SubtaskModal({ subtask, onSave, onDelete, onClose }) {
  const [text, setText] = useState(subtask?.text || '');
  const [est, setEst] = useState(subtask?.est || 15);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) {
      alert('请输入子任务内容');
      return;
    }
    onSave({ text: text.trim(), est: parseInt(est) || 15 });
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'rgba(13,20,38,0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,179,237,0.2)',
        borderRadius: '16px',
        padding: '24px'
      }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: '600',
          color: '#f1f5f9',
          marginBottom: '20px'
        }}>
          ✏️ 编辑子任务
        </h3>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              任务内容
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="例如：打开文档查看要求"
              autoFocus
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '8px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              color: '#e2e8f0',
              marginBottom: '8px'
            }}>
              预计时长（分钟）
            </label>
            <input
              type="number"
              value={est}
              onChange={(e) => setEst(e.target.value)}
              min="5"
              max="120"
              step="5"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                color: '#f1f5f9',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '8px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                style={{
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#ef4444',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                删除
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '13px',
                fontWeight: '600',
                color: '#94a3b8',
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '13px',
                fontWeight: '600',
                color: '#fff',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
 // ========== 获取当前登录用户 ==========
  const { data: session } = useSession();
  const userId = session?.user?.id || session?.user?.email;

  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [focusTask, setFocusTask] = useState(null);
  const [focusTime, setFocusTime] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [calendar, setCalendar] = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY); // 当前选中的日期
  const [viewMonth, setViewMonth] = useState(new Date()); // 当前日历视图月份
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false); // 控制日历展开/收起

// ========== 在这里插入新增的过滤与排序状态 ==========
  const [taskFilter, setTaskFilter] = useState('all'); // all, pending, done
  const [taskSort, setTaskSort] = useState('date'); // date, time, category

  // ========== 新增状态 ==========
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingSubtask, setEditingSubtask] = useState(null);
 
  // ========== 添加能量球状态 ==========
  const [orbPhase, setOrbPhase] = useState(0); // 涟漪动画相位

  // ========== 能量通知状态 ==========
  const [energyNotification, setEnergyNotification] = useState({
    visible: false,
    type: 'recovery',
    amount: 0
  });

  const showEnergyNotification = (type, amount) => {
    setEnergyNotification({
      visible: true,
      type,
      amount
    });
};

  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks'); // 'chat' or 'tasks'

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [showEnergyDetail, setShowEnergyDetail] = useState(false);

  // ========== 精力系统状态 ==========
  const [energyLevel, setEnergyLevel] = useState(100);
  
  // ========== 语音输入状态 ==========
  const [isListening, setIsListening] = useState(false);
  
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const lastFocusUpdate = useRef(Date.now());

// 在 MindFlowApp 中添加检查
useEffect(() => {
  if (!userId) return;
  
  // 检查是否是新的一天
  const lastDate = localStorage.getItem('mindflow_last_active_date');
  const today = new Date().toISOString().slice(0, 10);
  
  if (lastDate && lastDate !== today) {
    // 显示新一天提示
    setTimeout(() => {
      alert('🌅 新的一天开始了！\n\n您的精力已重置为 100%\n\n准备好迎接新的挑战吧！');
    }, 1000);
  }
  
  localStorage.setItem('mindflow_last_active_date', today);
}, [userId]);

// 初始化精力系统
useEffect(() => {
  if (!userId) return;
  
  const energyData = initializeEnergy(userId);
  setEnergyLevel(energyData.level);
  
  // 每分钟检查被动衰减
  const decayInterval = setInterval(() => {
    const data = getEnergyData(userId);
    if (data) {
      setEnergyLevel(data.level);
    }
  }, 60000); // 每分钟更新一次
  
  return () => clearInterval(decayInterval);
}, [userId]);

// 初始化加载数据并自动生成重复任务
  useEffect(() => {
    if (!userId) return;

    const allData = loadAllData(userId);
    const saved = allData[selectedDate];
    
    // 1. 加载现有任务
    let currentTasks = [];
    let currentMessages = [];
    if (saved) {
      currentTasks = saved.tasks || [];
      currentMessages = saved.messages || [];
    }
    
    // 2. 检查并生成重复任务 (仅对今天或未来日期生成)
    const recurringTasks = [];
    if (selectedDate >= TODAY) {
      // 遍历所有历史数据来寻找需要重复的任务
      Object.keys(allData).forEach(date => {
        const dayData = allData[date];
        if (dayData && dayData.tasks) {
          dayData.tasks.forEach(task => {
            if (task.repeat && task.repeat !== 'none') {
              const newTask = generateRecurringTasks(task, selectedDate);
              if (newTask) recurringTasks.push(newTask);
            }
          });
        }
      });
    }

    // 3. 最终汇总并修复重复 ID
    const allTasks = [...currentTasks, ...recurringTasks];
    const uniqueTasks = [];
    const usedIds = new Set();
    
    allTasks.forEach(t => {
      let task = { ...t };
      if (usedIds.has(task.id)) {
        task.id = `${task.id}_fixed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      uniqueTasks.push(task);
      usedIds.add(task.id);
    });

    setTasks(uniqueTasks);
    setMessages(currentMessages);
    
    loadCalendar();
  }, [userId, selectedDate]);

  // 自动保存
  useEffect(() => {
    if (!userId) return;

    // 只有在有内容时才保存，且保存到当前选中的日期
    if (tasks.length > 0 || messages.length > 0) {
      saveDateData(userId, selectedDate, {
        date: selectedDate,
        tasks,
        messages
      });
    }
  }, [tasks, messages, userId, selectedDate]);

// 专注模式计时器（包含能量消耗）
useEffect(() => {
  if (!isPaused && focusTask && userId) {
    timerRef.current = setInterval(() => {
      setFocusTime(t => {
        const now = Date.now();
        const minutesPassed = (now - lastFocusUpdate.current) / (1000 * 60);
        
        // 每分钟消耗精力
        if (minutesPassed >= 1) {
          const drain = calculateFocusDrain(minutesPassed);
          const newLevel = drainEnergy(userId, drain, '专注模式');
          setEnergyLevel(newLevel);
          lastFocusUpdate.current = now;
        }
        
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
    lastFocusUpdate.current = Date.now();
  }
  return () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };
}, [isPaused, focusTask, userId]);

// ========== 能量球涟漪动画 ==========
useEffect(() => {
  const interval = setInterval(() => {
    setOrbPhase(prev => (prev + 1) % 360);
  }, 50); // 每50ms更新一次
  
  return () => clearInterval(interval);
}, []);

  // 加载打卡日历 (月视图)
  function loadCalendar() {
    if (!userId) return;

    const allData = loadAllData(userId);
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    
    // 获取当月第一天和最后一天
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // 补全日历开头 (周日开始)
    const days = [];
    const startOffset = firstDay.getDay();
    for (let i = startOffset; i > 0; i--) {
      const date = new Date(year, month, 1 - i);
      days.push(generateDayInfo(date, allData));
    }
    
    // 当月天数
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const date = new Date(year, month, i);
      days.push(generateDayInfo(date, allData));
    }
    
    // 补全日历结尾
    const endOffset = 42 - days.length; // 保持 6 行 7 列
    for (let i = 1; i <= endOffset; i++) {
      const date = new Date(year, month + 1, i);
      days.push(generateDayInfo(date, allData));
    }
    
    setCalendar(days);
  }

  function generateDayInfo(date, allData) {
    const dateStr = date.toISOString().slice(0, 10);
    const dayData = allData[dateStr];
    const completed = dayData?.tasks?.filter(t => t.done).length || 0;
    
    return {
      date: dateStr,
      day: date.getDate(),
      month: date.getMonth(),
      weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      completed,
      isToday: dateStr === TODAY,
      isSelected: dateStr === selectedDate,
      isCurrentMonth: date.getMonth() === viewMonth.getMonth()
    };
  }

  const changeMonth = (offset) => {
    const next = new Date(viewMonth);
    next.setMonth(next.getMonth() + offset);
    setViewMonth(next);
  };

  useEffect(() => {
    loadCalendar();
  }, [viewMonth, selectedDate, userId, tasks]);

// ========== 插入此处：键盘快捷键逻辑 ==========
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ctrl/Cmd + K 快速添加任务
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowAddModal(true);
      }
      
      // ESC 关闭模态框
      if (e.key === 'Escape') {
        setShowAddModal(false);
        setShowEditModal(false);
        setEditingSubtask(null);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []); // 保持空依赖数组，确保监听器只在挂载时注册一次

  // ========== 任务超时检测与处理 ==========
  useEffect(() => {
    if (!userId) return;

    const checkOverdue = () => {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const today = now.toISOString().slice(0, 10);

      setTasks(prev => {
        let hasChanges = false;
        const updated = prev.map(t => {
          if (t.done || !t.startTime) return t;
          
          const [h, m] = t.startTime.split(':').map(Number);
          const taskMin = h * 60 + m;
          
          // 判定超时条件：
          // 1. 日期是今天且当前时间 > 开始时间 + 15分钟 (给一点缓冲时间)
          // 2. 日期早于今天
          const isLateToday = t.date === today && currentMin > taskMin + 15;
          const isLateHistory = t.date < today;

          if ((isLateToday || isLateHistory) && !t.isOverdue) {
            hasChanges = true;
            return { ...t, isOverdue: true };
          }
          return t;
        });
        return hasChanges ? updated : prev;
      });
    };

    const timer = setInterval(checkOverdue, 60000);
    checkOverdue();
    return () => clearInterval(timer);
  }, [userId]);

  // 监听任务超时并提示询问
  useEffect(() => {
    const overdueTask = tasks.find(t => t.isOverdue && !t.promptedForPostpone);
    if (overdueTask) {
      // 标记已提示，防止重复弹窗
      setTasks(prev => prev.map(t => 
        t.id === overdueTask.id ? { ...t, promptedForPostpone: true } : t
      ));
      
      // 延迟提示，避免在 React 渲染期间弹出 window.confirm
      setTimeout(() => {
        if (window.confirm(`任务「${overdueTask.title}」已超时未完成，是否延后到明天？`)) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().slice(0, 10);
          
          updateTask(overdueTask.id, { 
            date: tomorrowStr, 
            isOverdue: false, 
            promptedForPostpone: false 
          });
          alert('任务已成功延后到明天');
        }
      }, 1000);
    }
  }, [tasks]);

  // =============================================
useEffect(() => {
    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    // 每分钟检查一次提醒
    const reminderInterval = setInterval(() => {
      checkReminders(tasks);
    }, 60000);
    
    return () => clearInterval(reminderInterval);
  }, [tasks]);
  
// 发送消息
  // ========== 语音输入控制 ==========
  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音识别功能，请使用 Chrome 浏览器。');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0])
        .map(result => result.transcript)
        .join('');
      
      setInput(transcript);
    };

    recognition.start();
  };

  // ========== 输入框自适应高度 ==========
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [input]);

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
      const result = await callAI(userMessage, () => buildSystemPrompt(tasks));

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
    // 过滤掉已经在列表中的相同 ID 任务（以防万一）
    const existingIds = new Set(prev.map(t => t.id));
    const uniqueNewTasks = messageTasks.filter(t => !existingIds.has(t.id));
    
    const newTasks = [...prev, ...uniqueNewTasks];
    console.log('任务已添加，当前任务数:', newTasks.length);
    return newTasks;
  });
  
  // 标记该消息的任务已添加
  setMessages(prev => prev.map(msg => 
    msg.id === messageId ? { ...msg, tasksAdded: true } : msg
  ));
};

// ========== 手动添加任务 ==========
const addManualTask = (taskData) => {
  const newTask = {
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: taskData.title,
    category: taskData.category || 'work',
    duration: taskData.duration || 30,
    startTime: taskData.startTime || null,
    deadline: taskData.deadline || null,
    date: taskData.date || selectedDate,
    reminder: taskData.reminder || null,
    repeat: taskData.repeat || 'none',
    done: false,
    subtasks: []
  };
  
  setTasks(prev => [...prev, newTask]);
  setShowAddModal(false);
};

// ========== 编辑任务 ==========
const updateTask = (taskId, updates) => {
  setTasks(prev => prev.map(t => 
    t.id === taskId ? { ...t, ...updates } : t
  ));
  setShowEditModal(false);
  setEditingTask(null);
};

// ========== 编辑子任务 ==========
const updateSubtask = (taskId, subtaskId, updates) => {
  setTasks(prev => prev.map(t => 
    t.id === taskId ? {
      ...t,
      subtasks: t.subtasks.map(s => 
        s.id === subtaskId ? { ...s, ...updates } : s
      )
    } : t
  ));
  setEditingSubtask(null);
};

// ========== 删除子任务 ==========
const deleteSubtask = (taskId, subtaskId) => {
  if (!confirm('确定要删除这个子任务吗？')) return;
  
  setTasks(prev => prev.map(t => 
    t.id === taskId ? {
      ...t,
      subtasks: t.subtasks.filter(s => s.id !== subtaskId)
    } : t
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
  setTasks(prev => {
    const updated = prev.map(t => {
      if (t.id === id) {
        const newDone = !t.done;
        
        // 如果是完成任务，恢复能量
        // if (newDone && userId) {
        //   const recovery = calculateRecovery(t.duration);
        //   const newLevel = recoverEnergy(userId, recovery, `完成任务: ${t.title}`);
        //   setEnergyLevel(newLevel);
        //   showEnergyNotification('recovery', recovery); // ← 显示通知
          
        //   console.log('🎉 任务完成！');
        // }
        
        return { ...t, done: newDone };
      }
      return t;
    });
    
    return updated;
  });
};

  const deleteTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (window.confirm(`确定要删除任务「${task?.title || '未命名'}」吗？`)) {
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

// ========== 插入此处：任务过滤和排序逻辑 ==========
  const getFilteredTasks = () => {
    let filtered = [...tasks];
    
    // 1. 过滤逻辑
    if (taskFilter === 'pending') {
      filtered = filtered.filter(t => !t.done);
    } else if (taskFilter === 'done') {
      filtered = filtered.filter(t => t.done);
    }
    
    // 2. 排序逻辑 (稳定且支持多级排序)
    filtered.sort((a, b) => {
      // 辅助函数：标准化时间格式，确保 9:00 -> 09:00
      const normalizeTime = (t) => {
        if (!t) return '99:99';
        if (t.length === 4) return '0' + t;
        return t;
      };

      const dateA = a.date || '';
      const dateB = b.date || '';
      const timeA = normalizeTime(a.startTime);
      const timeB = normalizeTime(b.startTime);

      if (taskSort === 'date') {
        // 先按日期排，同日期的按时间排
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return timeA.localeCompare(timeB);
      } else if (taskSort === 'time') {
        // 先按时间排，同时间的按日期排
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        return dateA.localeCompare(dateB);
      } else if (taskSort === 'category') {
        // 先按分类排，同分类的按日期+时间排
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return timeA.localeCompare(timeB);
      }
      return 0;
    });
    
    return filtered;
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

{/* 实时精力显示 */}
<div style={{
  marginTop: '16px',
  padding: '12px 24px',
  background: 'rgba(13,20,38,0.6)',
  border: `1px solid ${getEnergyStatus(energyLevel).color.primary}40`,
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
}}>
  <span style={{ fontSize: '18px' }}>⚡</span>
  <div style={{ flex: 1 }}>
    <div style={{
      fontSize: '11px',
      color: '#94a3b8',
      marginBottom: '4px'
    }}>
      当前精力
    </div>
    <div style={{
      height: '4px',
      background: 'rgba(30,41,59,0.6)',
      borderRadius: '2px',
      overflow: 'hidden'
    }}>
      <div style={{
        height: '100%',
        width: `${energyLevel}%`,
        background: `linear-gradient(to right, ${getEnergyStatus(energyLevel).color.secondary}, ${getEnergyStatus(energyLevel).color.primary})`,
        transition: 'width 0.5s'
      }} />
    </div>
  </div>
  <div style={{
    fontSize: '16px',
    fontWeight: '600',
    color: getEnergyStatus(energyLevel).color.primary
  }}>
    {Math.round(energyLevel)}%
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
        <EnergyNotification
          type={energyNotification.type}
          amount={energyNotification.amount}
          visible={energyNotification.visible}
          onClose={() => setEnergyNotification({ ...energyNotification, visible: false })}
        />
      </div>
    );
  }

  // 主界面
  return (
    <div style={{
      height: '100vh',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #040810 0%, #0d1426 100%)',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      {/* 移动端 Tab 切换 */}
      {isMobile && (
        <div style={{
          display: 'flex',
          background: 'rgba(13,20,38,0.95)',
          borderBottom: '1px solid rgba(99,179,237,0.1)',
          padding: '12px 16px',
          gap: '12px',
          zIndex: 100
        }}>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '10px',
              background: activeTab === 'chat' ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'rgba(30,41,59,0.6)',
              color: '#fff',
              border: 'none',
              fontSize: '14px',
              fontWeight: '600'
            }}
          >
            💬 AI 助手
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '10px',
              background: activeTab === 'tasks' ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'rgba(30,41,59,0.6)',
              color: '#fff',
              border: 'none',
              fontSize: '14px',
              fontWeight: '600'
            }}
          >
            📋 任务清单
          </button>
        </div>
      )}

      {/* 左侧：AI 对话 */}
      <div style={{
        width: isMobile ? '100%' : '400px',
        height: isMobile ? 'calc(100% - 60px)' : '100%',
        display: (isMobile && activeTab !== 'chat') ? 'none' : 'flex',
        borderRight: isMobile ? 'none' : '1px solid rgba(99,179,237,0.1)',
        flexDirection: 'column',
        background: 'rgba(4,8,16,0.4)',
        overflow: 'hidden'
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

<div 
  onClick={() => setShowEnergyDetail(true)}
  style={{ cursor: 'pointer' }}
>
  <EnergyOrb 
    energyLevel={energyLevel} 
    phase={orbPhase}
    tasks={tasks}
  />
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
            flexDirection: 'column',
            gap: '8px',
            background: 'rgba(13,20,38,0.8)',
            border: `1px solid ${isListening ? '#10b981' : 'rgba(99,179,237,0.15)'}`,
            borderRadius: '12px',
            padding: '8px',
            transition: 'border-color 0.3s'
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isListening ? '正在聆听...' : '告诉我今天要做什么...'}
              disabled={thinking}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e2e8f0',
                fontSize: '14px',
                padding: '8px',
                resize: 'none',
                maxHeight: '400px',
                overflowY: 'auto',
                lineHeight: '1.5'
              }}
            />
            
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 4px'
            }}>
              <button
                onClick={toggleListening}
                title={isListening ? '停止语音识别' : '开始语音输入'}
                style={{
                  background: isListening ? 'rgba(16,185,129,0.2)' : 'transparent',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isListening ? '#10b981' : '#94a3b8',
                  transition: 'all 0.2s'
                }}
              >
                <span style={{ fontSize: '18px' }}>{isListening ? '🛑' : '🎤'}</span>
              </button>

              <button
                onClick={handleSend}
                disabled={thinking || !input.trim()}
                style={{
                  padding: '6px 16px',
                  background: thinking || !input.trim()
                    ? 'rgba(99,179,237,0.2)'
                    : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
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
      </div>

      {/* 右侧：任务列表 */}
      <div style={{
        flex: 1,
        height: isMobile ? 'calc(100% - 60px)' : '100%',
        display: (isMobile && activeTab !== 'tasks') ? 'none' : 'flex',
        flexDirection: 'column',
        padding: isMobile ? '16px' : '32px',
        overflowY: 'auto',
        background: 'rgba(4,8,16,0.2)'
      }}>
        {/* 统计卡片 */}
  <div style={{
    display: 'grid',
    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
    gap: isMobile ? '12px' : '16px',
    marginBottom: '24px'
  }}>
    {[
      { 
        label: '总任务', 
        value: stats.total, 
        color: '#3b82f6', 
        icon: '📋',
        detail: `${Math.round(stats.done / stats.total * 100 || 0)}% 完成`
      },
      { 
        label: '已完成', 
        value: stats.done, 
        color: '#10b981', 
        icon: '✓',
        detail: `还剩 ${stats.pending} 个`
      },
      { 
        label: '进行中', 
        value: stats.pending, 
        color: '#f59e0b', 
        icon: '⏳',
        detail: tasks.filter(t => !t.done && t.startTime).length > 0 
          ? `下一个: ${tasks.filter(t => !t.done && t.startTime).sort((a, b) => 
              (a.startTime || '').localeCompare(b.startTime || '')
            )[0]?.startTime}` 
          : '暂无计划'
      },
      { 
        label: '专注时长', 
        value: `${stats.focusMinutes}分`, 
        color: '#8b5cf6', 
        icon: '🎯',
        detail: `今日目标 ${Math.round(stats.focusMinutes / 6)}%`
      }
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
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
          {stat.label}
        </div>
        <div style={{ fontSize: '11px', color: '#64748b' }}>
          {stat.detail}
        </div>
      </div>
    ))}
  </div>      

        {/* 打卡日历 (月视图) */}
        <div style={{
          padding: '24px',
          background: 'rgba(13,20,38,0.6)',
          border: '1px solid rgba(99,179,237,0.1)',
          borderRadius: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: '600',
                color: '#f1f5f9',
                margin: 0
              }}>
                📅 {viewMonth.getFullYear()}年 {viewMonth.getMonth() + 1}月
              </h3>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => changeMonth(-1)}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(99,179,237,0.1)',
                    border: '1px solid rgba(99,179,237,0.2)',
                    borderRadius: '4px',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  ◀
                </button>
                <button
                  onClick={() => changeMonth(1)}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(99,179,237,0.1)',
                    border: '1px solid rgba(99,179,237,0.2)',
                    borderRadius: '4px',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  ▶
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '13px', color: '#6ee7b7' }}>
                🔥 连续 {streak} 天
              </div>
              <button
                onClick={() => {
                  setSelectedDate(TODAY);
                  setViewMonth(new Date());
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: 'rgba(37,99,235,0.1)',
                  border: '1px solid rgba(37,99,235,0.2)',
                  borderRadius: '6px',
                  color: '#60a5fa',
                  cursor: 'pointer'
                }}
              >
                回到今天
              </button>
              <button
                onClick={() => setIsCalendarExpanded(!isCalendarExpanded)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: 'rgba(99,179,237,0.1)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: '6px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {isCalendarExpanded ? '收起 ▴' : '展开 ▾'}
              </button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '8px',
            maxHeight: isCalendarExpanded ? '400px' : '80px',
            overflow: 'hidden',
            transition: 'max-height 0.3s ease-in-out'
          }}>
            {['日', '一', '二', '三', '四', '五', '六'].map(w => (
              <div key={w} style={{
                textAlign: 'center',
                fontSize: '12px',
                color: '#64748b',
                paddingBottom: '8px'
              }}>
                {w}
              </div>
            ))}
            {(isCalendarExpanded ? calendar : (() => {
              const selectedIdx = calendar.findIndex(d => d.date === selectedDate);
              const todayIdx = calendar.findIndex(d => d.date === TODAY);
              const targetIdx = selectedIdx !== -1 ? selectedIdx : (todayIdx !== -1 ? todayIdx : 0);
              const rowStart = Math.floor(targetIdx / 7) * 7;
              return calendar.slice(rowStart, rowStart + 7);
            })()).map((day, idx) => (
              <div
                key={`${day.date}-${idx}`}
                onClick={() => setSelectedDate(day.date)}
                style={{
                  position: 'relative',
                  padding: '10px 4px',
                  background: day.isSelected 
                    ? 'rgba(37,99,235,0.2)' 
                    : day.completed > 0 
                      ? 'rgba(16,185,129,0.1)' 
                      : 'rgba(99,179,237,0.02)',
                  border: day.isSelected
                    ? '1px solid #3b82f6'
                    : day.isToday
                      ? '1px solid rgba(16,185,129,0.5)'
                      : '1px solid rgba(99,179,237,0.05)',
                  borderRadius: '8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  opacity: day.isCurrentMonth ? 1 : 0.3,
                  transition: 'all 0.2s'
                }}
              >
                <div style={{
                  fontSize: '14px',
                  fontWeight: day.isSelected || day.isToday ? '700' : '400',
                  color: day.isSelected ? '#fff' : day.isToday ? '#10b981' : '#94a3b8',
                }}>
                  {day.day}
                </div>
                {day.completed > 0 && (
                  <div style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: '#10b981'
                  }} />
                )}
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
    marginBottom: '16px', // 确保标题下方的间距缩减，让过滤器靠得更近
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  }}>
    <span>📋 {selectedDate === TODAY ? '今日任务' : `${selectedDate} 任务`}</span>
    <button
      onClick={() => setShowAddModal(true)}
      style={{
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: '600',
        color: '#fff',
        background: 'linear-gradient(135deg, #10b981, #059669)',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: '0 2px 8px rgba(16,185,129,0.3)'
      }}
    >
      ➕ 添加任务
    </button>
  </h2>

  {/* 过滤器 UI */}
  <div style={{
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
    flexWrap: 'wrap'
  }}>
    {/* 状态过滤按钮组 */}
    <div style={{ display: 'flex', gap: '4px' }}>
      {[
        { value: 'all', label: '全部', icon: '📋' },
        { value: 'pending', label: '待完成', icon: '⏳' },
        { value: 'done', label: '已完成', icon: '✓' }
      ].map(filter => (
        <button
          key={filter.value}
          onClick={() => setTaskFilter(filter.value)}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: '500',
            color: taskFilter === filter.value ? '#fff' : '#94a3b8',
            background: taskFilter === filter.value
              ? 'linear-gradient(135deg, #2563eb, #7c3aed)'
              : 'rgba(30,41,59,0.6)',
            border: `1px solid ${taskFilter === filter.value ? '#2563eb' : 'rgba(99,179,237,0.2)'}`,
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {filter.icon} {filter.label}
        </button>
      ))}
    </div>

    {/* 排序下拉框 */}
    <select
      value={taskSort}
      onChange={(e) => setTaskSort(e.target.value)}
      style={{
        padding: '6px 12px',
        fontSize: '12px',
        color: '#e2e8f0',
        background: 'rgba(30,41,59,0.6)',
        border: '1px solid rgba(99,179,237,0.2)',
        borderRadius: '6px',
        outline: 'none',
        cursor: 'pointer'
      }}
    >
      <option value="date">按日期排序</option>
      <option value="time">按时间排序</option>
      <option value="category">按分类排序</option>
    </select>
  </div>

{/* ================== 在这里插入/替换以下代码 ================== */}
{getFilteredTasks().length === 0 ? ( // 注意：这里也将 tasks 改为 getFilteredTasks() 以确保过滤结果为空时显示提示
  <div style={{
    textAlign: 'center',
    padding: '80px 20px',
    color: '#64748b'
  }}>
    <div style={{ fontSize: '64px', marginBottom: '16px' }}>✦</div>
    <p style={{ fontSize: '16px', margin: '0 0 8px' }}>
      还没有符合条件的任务
    </p>
    <p style={{ fontSize: '14px', margin: 0, color: '#475569' }}>
      点击"➕ 添加任务"或在左侧告诉 AI 你要做什么
    </p>
  </div>
) : (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  }}>
    {getFilteredTasks().map((task) => {  // 使用过滤并排序后的数组渲染
      const cat = CATEGORIES[task.category];
      return (
        <div key={task.id} style={{
            padding: '16px',
            background: task.done ? 'rgba(16,185,129,0.08)' : 'rgba(99,179,237,0.05)',
            border: task.done ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(99,179,237,0.15)',
            borderRadius: '12px'
        }}>
          {/* 这里是之前为你提供的带彩色标签的任务卡片内部结构 */}
          {/* ... 包括复选框、标题、彩色标签组、操作按钮等 ... */}


          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            gap: '12px',
            marginBottom: task.subtasks?.length > 0 ? '12px' : 0
          }}>
            <div style={{ display: 'flex', gap: '12px', width: isMobile ? '100%' : 'auto' }}>
              {/* 状态勾选按钮 */}
              <button
                onClick={() => toggleTask(task.id)}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: task.done ? '2px solid #10b981' : '2px solid rgba(99,179,237,0.4)',
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
                {/* 标题 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '16px' }}>{cat.icon}</span>
                  <span 
                    onClick={() => {
                      setEditingTask(task);
                      setShowEditModal(true);
                    }}
                    style={{
                      fontSize: '15px',
                      fontWeight: '500',
                      color: task.done ? '#94a3b8' : '#e2e8f0',
                      textDecoration: task.done ? 'line-through' : 'none',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    {task.title}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, width: '100%' }}>
              {/* 多维度标签展示区域 (Pills) */}
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#64748b', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: '4px', background: `${cat.color}20`, color: cat.color }}>
                  {cat.label}
                </span>
                {task.isOverdue && !task.done && (
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 'bold' }}>
                    ⚠️ 已超时
                  </span>
                )}
                {task.date && (
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: task.date !== TODAY ? 'rgba(251,191,36,0.1)' : 'rgba(99,179,237,0.1)',
                    color: task.date !== TODAY ? '#fbbf24' : '#60a5fa'
                  }}>
                    📅 {formatDate(task.date)}
                  </span>
                )}
                <span>⏱ {task.duration}分钟</span>
                {task.startTime && (
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>
                    🕐 {task.startTime}
                  </span>
                )}
                {task.deadline && (
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                    ⏰ 截止 {task.deadline}
                  </span>
                )}
                {task.reminder && task.reminder !== '' && (
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                    🔔 {task.reminder === '0' ? '准时提醒' : `提前 ${task.reminder} 分钟`}
                  </span>
                )}
                {task.repeat && task.repeat !== 'none' && (
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                    🔄 {
                      task.repeat === 'daily' ? '每天' :
                      task.repeat === 'weekdays' ? '工作日' :
                      task.repeat === 'weekly' ? '每周' :
                      task.repeat === 'monthly' ? '每月' : '重复'
                    }
                  </span>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ 
              display: 'flex', 
              gap: '8px', 
              flexShrink: 0,
              width: isMobile ? '100%' : 'auto',
              justifyContent: isMobile ? 'flex-end' : 'flex-start',
              marginTop: isMobile ? '8px' : 0
            }}>
              {!task.done && !task.subtasks?.length && (
                <button onClick={() => breakdownTask(task.id)} style={{ padding: '6px 12px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '6px', color: '#a78bfa', fontSize: '12px', cursor: 'pointer' }}>🧩 拆解</button>
              )}
              {!task.done && (
                <button onClick={() => startFocus(task)} style={{ padding: '6px 12px', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: '6px', color: '#60a5fa', fontSize: '12px', cursor: 'pointer' }}>🎯 专注</button>
              )}
              <button onClick={() => deleteTask(task.id)} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}>删除</button>
            </div>
          </div>

          {/* 子任务 (保持原有逻辑) */}
          {task.subtasks?.length > 0 && (
            <div style={{ marginLeft: '36px', paddingLeft: '16px', borderLeft: '2px solid rgba(99,179,237,0.2)' }}>
              {task.subtasks.map((sub, i) => (
                <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', marginBottom: '4px', borderRadius: '6px', background: sub.done ? 'rgba(16,185,129,0.05)' : 'transparent' }}>
                   {/* 这里保留你代码中原有的子任务渲染逻辑 */}
                   <div onClick={() => toggleSubtask(task.id, sub.id)} style={{ width: '16px', height: '16px', borderRadius: '50%', border: sub.done ? '2px solid #10b981' : '2px solid rgba(99,179,237,0.3)', background: sub.done ? '#10b981' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff' }}>{sub.done && '✓'}</div>
                   <span style={{ fontSize: '13px', color: sub.done ? '#94a3b8' : '#cbd5e1', textDecoration: sub.done ? 'line-through' : 'none' }}>{i + 1}. {sub.text}</span>
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
  
  @keyframes celebrate {
    0%, 100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
    25% { transform: translate(-50%, -50%) scale(1.2) rotate(-10deg); }
    75% { transform: translate(-50%, -50%) scale(1.2) rotate(10deg); }
  }
  
  @keyframes shimmer {
    0% { left: -100%; }
    100% { left: 200%; }
  }
  
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: rgba(99,179,237,0.05);
    borderRadius: 4px;
  }
  
  ::-webkit-scrollbar-thumb {
    background: rgba(99,179,237,0.2);
    borderRadius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(99,179,237,0.3);
  }
`}</style>

{/* ========== 添加/编辑任务模态框 ========== */}
      {showAddModal && (
        <TaskModal
          isNew={true}
          onSave={addManualTask}
          onClose={() => setShowAddModal(false)}
          defaultDate={selectedDate}
          isMobile={isMobile}
        />
      )}

      {showEditModal && editingTask && (
        <TaskModal
          task={editingTask}
          isNew={false}
          onSave={(updates) => updateTask(editingTask.id, updates)}
          onClose={() => {
            setShowEditModal(false);
            setEditingTask(null);
          }}
          defaultDate={selectedDate}
          isMobile={isMobile}
        />
      )}

      {/* ========== 编辑子任务模态框 ========== */}
      {editingSubtask && (
        <SubtaskModal
          subtask={editingSubtask.subtask}
          onSave={(updates) => {
            updateSubtask(
              editingSubtask.taskId,
              editingSubtask.subtask.id,
              updates
            );
          }}
          onDelete={() => {
            deleteSubtask(editingSubtask.taskId, editingSubtask.subtask.id);
            setEditingSubtask(null);
          }}
          onClose={() => setEditingSubtask(null)}
        />
      )}

       {showEnergyDetail && (
        <EnergyDetailModal
          energyLevel={energyLevel}
          tasks={tasks}
          onClose={() => setShowEnergyDetail(false)}
        />
      )}

      <EnergyNotification
        type={energyNotification.type}
        amount={energyNotification.amount}
        visible={energyNotification.visible}
        onClose={() => setEnergyNotification({ ...energyNotification, visible: false })}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 精力球组件（精力值系统）
// ═══════════════════════════════════════════════════════════════════

function EnergyOrb({ energyLevel, phase, tasks }) {
  const status = getEnergyStatus(energyLevel);
  const colors = status.color;
  
  // 根据精力等级调整涟漪速度和强度
  const rippleSpeed = status.rippleSpeed;
  const rippleIntensity = status.rippleIntensity;
  
  // 涟漪动画（速度随精力变化）
  const ripple1 = Math.sin(phase * rippleSpeed) * 0.2 * rippleIntensity;
  const ripple2 = Math.sin(phase * rippleSpeed * 1.4 + Math.PI / 2) * 0.15 * rippleIntensity;
  const ripple3 = Math.sin(phase * rippleSpeed * 0.6 + Math.PI) * 0.1 * rippleIntensity;
  
  // 计算待完成任务数
  const pendingTasks = tasks.filter(t => !t.done).length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      padding: '24px'
    }}>
      {/* 能量球主体 */}
      <div style={{
        position: 'relative',
        width: '140px',
        height: '140px'
      }}>
        {/* 外层光晕 */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${1.5 + ripple1})`,
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.glow}30, transparent)`,
          opacity: 0.6,
          transition: 'transform 0.1s ease-out'
        }} />

        {/* 中层涟漪 */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${1.2 + ripple2})`,
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.primary}50, transparent)`,
          opacity: 0.5,
          transition: 'transform 0.1s ease-out'
        }} />

        {/* 内层核心 */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${0.95 + ripple3})`,
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, ${colors.glow}, ${colors.primary} 60%, ${colors.secondary})`,
          boxShadow: `
            0 0 30px ${colors.primary}80,
            0 0 60px ${colors.primary}40,
            inset 0 0 30px ${colors.glow}40
          `,
          opacity: 0.4 + (energyLevel / 100) * 0.6,
          transition: 'transform 0.1s ease-out, opacity 0.5s, box-shadow 0.5s',
          overflow: 'hidden'
        }}>
          {/* 高光 */}
          <div style={{
            position: 'absolute',
            top: '15%',
            left: '15%',
            width: '35%',
            height: '35%',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.9), transparent 70%)',
            filter: 'blur(5px)'
          }} />

          {/* 精力液面 */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${energyLevel}%`,
            background: `linear-gradient(to top, ${colors.secondary}, ${colors.primary} 50%, ${colors.glow})`,
            borderRadius: '0 0 50% 50%',
            transition: 'height 0.8s ease-out',
            overflow: 'hidden'
          }}>
            {/* 液面波动 */}
            <div style={{
              position: 'absolute',
              top: -8,
              left: -20,
              right: -20,
              height: 16,
              background: colors.glow,
              borderRadius: '50%',
              filter: 'blur(4px)',
              transform: `translateY(${Math.sin(phase * 0.05) * 4}px) translateX(${Math.cos(phase * 0.03) * 3}px)`
            }} />
          </div>
        </div>

        {/* 能量粒子（根据精力状态调整数量和活跃度）*/}
        {energyLevel > 10 && (
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              // 根据精力显示不同数量的粒子
              const particleCount = Math.ceil((energyLevel / 100) * 6);
              if (i >= particleCount) return null;
              
              const angle = (phase * (2 + rippleSpeed * 10) + i * 60) % 360;
              const radian = (angle * Math.PI) / 180;
              const radius = 65 + Math.sin(phase * 0.08 + i) * 12 * rippleIntensity;
              const x = Math.cos(radian) * radius;
              const y = Math.sin(radian) * radius;
              const size = 3 + (energyLevel / 100) * 3;
              
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                    width: `${size}px`,
                    height: `${size}px`,
                    borderRadius: '50%',
                    background: colors.glow,
                    boxShadow: `0 0 ${8 + size * 2}px ${colors.glow}`,
                    opacity: 0.5 + (energyLevel / 200)
                  }}
                />
              );
            })}
          </>
        )}

        {/* 警告效果（精力低于 20%）*/}
        {energyLevel < 20 && energyLevel > 0 && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '120%',
            height: '120%',
            borderRadius: '50%',
            border: `2px solid ${colors.primary}`,
            opacity: Math.abs(Math.sin(phase * 0.2)),
            pointerEvents: 'none'
          }} />
        )}
      </div>

      {/* 精力数值 */}
      <div style={{
        textAlign: 'center'
      }}>
        <div style={{
          fontSize: '32px',
          fontWeight: '700',
          color: colors.primary,
          marginBottom: '4px',
          textShadow: `0 0 10px ${colors.glow}80`
        }}>
          {Math.round(energyLevel)}%
        </div>
        <div style={{
          fontSize: '14px',
          color: '#e2e8f0',
          fontWeight: '500',
          marginBottom: '4px'
        }}>
          {status.emoji} {status.label}
        </div>
        <div style={{
          fontSize: '11px',
          color: '#94a3b8',
          marginBottom: '8px'
        }}>
          {status.advice}
        </div>
        {pendingTasks > 0 && (
          <div style={{
            fontSize: '11px',
            color: '#64748b',
            padding: '4px 12px',
            background: 'rgba(99,179,237,0.1)',
            borderRadius: '12px',
            display: 'inline-block'
          }}>
            剩余 {pendingTasks} 个任务
          </div>
        )}
      </div>

      {/* 精力条 */}
      <div style={{
        width: '100%',
        maxWidth: '220px',
        height: '8px',
        background: 'rgba(30,41,59,0.8)',
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid rgba(99,179,237,0.2)',
        position: 'relative'
      }}>
        <div style={{
          height: '100%',
          width: `${energyLevel}%`,
          background: `linear-gradient(to right, ${colors.secondary}, ${colors.primary}, ${colors.glow})`,
          transition: 'width 0.8s ease-out',
          boxShadow: `0 0 15px ${colors.glow}`,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* 流光效果 */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: '-100%',
            width: '100%',
            height: '100%',
            background: `linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent)`,
            animation: 'shimmer 2s infinite',
            animationDelay: `${phase * 0.01}s`
          }} />
        </div>
      </div>

      {/* 建议提示（精力低时显示）*/}
      {energyLevel < 50 && (
        <div style={{
          padding: '8px 16px',
          background: `${colors.primary}20`,
          border: `1px solid ${colors.primary}40`,
          borderRadius: '8px',
          fontSize: '11px',
          color: colors.primary,
          textAlign: 'center',
          maxWidth: '220px'
        }}>
          {energyLevel < 20 
            ? '⚠️ 精力严重不足，建议休息'
            : `💡 推荐处理「${
                status.recommendation === 'work' ? '💼 工作' :
                status.recommendation === 'study' ? '📚 学习' :
                status.recommendation === 'life' ? '🏠 生活' : '休息'
              }」类任务`
          }
        </div>
      )}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════
// 精力详情面板
// ═══════════════════════════════════════════════════════════════════

function EnergyDetailModal({ energyLevel, tasks, onClose }) {
  const status = getEnergyStatus(energyLevel);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.done).length;
  const pendingTasks = totalTasks - completedTasks;
  
  // 按分类统计任务
  const tasksByCategory = {
    work: tasks.filter(t => t.category === 'work' && !t.done).length,
    study: tasks.filter(t => t.category === 'study' && !t.done).length,
    life: tasks.filter(t => t.category === 'life' && !t.done).length
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        background: 'rgba(13,20,38,0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,179,237,0.2)',
        borderRadius: '16px',
        padding: '32px',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        {/* 标题 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#f1f5f9',
            margin: 0
          }}>
            ⚡ 精力状态详情
          </h2>
          <button
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'rgba(99,179,237,0.1)',
              border: '1px solid rgba(99,179,237,0.2)',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        {/* 当前精力 */}
        <div style={{
          padding: '24px',
          background: `${status.color.primary}20`,
          border: `2px solid ${status.color.primary}`,
          borderRadius: '12px',
          marginBottom: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '48px',
            fontWeight: '700',
            color: status.color.primary,
            marginBottom: '8px'
          }}>
            {Math.round(energyLevel)}%
          </div>
          <div style={{
            fontSize: '16px',
            color: '#e2e8f0',
            marginBottom: '4px'
          }}>
            {status.emoji} {status.label}
          </div>
          <div style={{
            fontSize: '13px',
            color: '#94a3b8'
          }}>
            {status.advice}
          </div>
        </div>

        {/* 任务统计 */}
        <div style={{
          marginBottom: '24px'
        }}>
          <h3 style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#e2e8f0',
            marginBottom: '12px'
          }}>
            📊 任务统计
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px'
          }}>
            <div style={{
              padding: '12px',
              background: 'rgba(30,41,59,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#3b82f6',
                marginBottom: '4px'
              }}>
                {totalTasks}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#94a3b8'
              }}>
                总任务
              </div>
            </div>
            <div style={{
              padding: '12px',
              background: 'rgba(30,41,59,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#10b981',
                marginBottom: '4px'
              }}>
                {completedTasks}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#94a3b8'
              }}>
                已完成
              </div>
            </div>
            <div style={{
              padding: '12px',
              background: 'rgba(30,41,59,0.6)',
              border: '1px solid rgba(99,179,237,0.1)',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#f59e0b',
                marginBottom: '4px'
              }}>
                {pendingTasks}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#94a3b8'
              }}>
                待完成
              </div>
            </div>
          </div>
        </div>

        {/* 分类任务 */}
        <div style={{
          marginBottom: '24px'
        }}>
          <h3 style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#e2e8f0',
            marginBottom: '12px'
          }}>
            📋 待办任务分布
          </h3>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {[
              { key: 'work', label: '💼 工作', color: '#3b82f6' },
              { key: 'study', label: '📚 学习', color: '#8b5cf6' },
              { key: 'life', label: '🏠 生活', color: '#10b981' }
            ].map(cat => (
              <div
                key={cat.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(99,179,237,0.1)',
                  borderRadius: '8px'
                }}
              >
                <span style={{ fontSize: '14px' }}>{cat.label}</span>
                <div style={{
                  flex: 1,
                  height: '6px',
                  background: 'rgba(30,41,59,0.6)',
                  borderRadius: '3px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${pendingTasks > 0 ? (tasksByCategory[cat.key] / pendingTasks) * 100 : 0}%`,
                    background: cat.color,
                    transition: 'width 0.3s'
                  }} />
                </div>
                <span style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: cat.color,
                  minWidth: '30px',
                  textAlign: 'right'
                }}>
                  {tasksByCategory[cat.key]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 精力管理建议 */}
        <div style={{
          padding: '16px',
          background: 'rgba(99,179,237,0.1)',
          border: '1px solid rgba(99,179,237,0.2)',
          borderRadius: '12px'
        }}>
          <h3 style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#e2e8f0',
            marginBottom: '8px'
          }}>
            💡 精力管理建议
          </h3>
          <ul style={{
            fontSize: '12px',
            color: '#94a3b8',
            lineHeight: '1.6',
            margin: 0,
            paddingLeft: '20px'
          }}>
            {energyLevel >= 80 && (
              <>
                <li>精力充沛，适合处理复杂的工作任务</li>
                <li>可以安排需要深度思考的项目</li>
              </>
            )}
            {energyLevel >= 50 && energyLevel < 80 && (
              <>
                <li>状态良好，适合推进学习类任务</li>
                <li>保持专注，避免过度消耗精力</li>
              </>
            )}
            {energyLevel >= 20 && energyLevel < 50 && (
              <>
                <li>开始疲劳，建议处理轻松的生活任务</li>
                <li>考虑穿插休息，恢复精力</li>
              </>
            )}
            {energyLevel < 20 && (
              <>
                <li>精力严重不足，强烈建议休息</li>
                <li>完成简单任务来恢复精力</li>
                <li>避免开始新的复杂任务</li>
              </>
            )}
            <li>完成任务会恢复精力</li>
            <li>专注模式会持续消耗精力</li>
            <li>每天凌晨精力自动重置为100%</li>
          </ul>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: '24px',
            padding: '12px',
            fontSize: '14px',
            fontWeight: '600',
            color: '#fff',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer'
          }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}