import { useState, useEffect, useRef, useMemo } from 'react';
import { useSession, signIn } from 'next-auth/react';
import UserProfile from '../components/UserProfile';
import {
  initializeEnergy,
  drainEnergy,
  recoverEnergy,
  calculateRecovery,
  calculateFocusDrain,
  getEnergyData,
  saveEnergyData,
  getEnergyStatus,
  calcTaskCompletionDrain,
  checkOfflineRecovery,
} from '../lib/energySystem';

// ═══════════════════════════════════════════════════════════════════
// MindFlow v4.0 - 完整版
// 功能：用户认证 + AI任务提取 + 专注模式 + 任务拆解 + 打卡日历
// ═══════════════════════════════════════════════════════════════════

// ── 配置常量 ──────────────────────────────────────────────────────
const COLORS = {
  bg: '#05070a',
  surface: 'rgba(15, 20, 28, 0.7)',
  surfaceLighter: 'rgba(30, 41, 59, 0.5)',
  neonBlue: '#00f2ff',
  neonCyan: '#00d2ff',
  accent: '#3b82f6',
  textMain: '#f8fafc',
  textSecondary: '#94a3b8',
  border: 'rgba(0, 242, 255, 0.15)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  shadow: 'rgba(0, 242, 255, 0.1)',
};

const CATEGORIES = {
  work: { label: '工作', color: COLORS.neonBlue, icon: '💼' },
  study: { label: '学习', color: '#8b5cf6', icon: '📚' },
  life: { label: '生活', color: '#10b981', icon: '🏠' }
};

// const STORAGE_KEY = 'mindflow_v4';
const getLocalDateString = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const TODAY = getLocalDateString();

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

5. **SMART 原则**（优化任务标题）：
   - Specific（具体）：动词+对象+量化标准，如"写完项目周报初稿"
   - Measurable（可衡量）：包含可验证的完成标准
   - Time-bound（有时限）：结合上下文推断合理开始时间

返回 JSON（无 Markdown）：
{
  "summary": "确认语（20字内）",
  "tasks": [
    {
      "title": "任务标题（SMART优化后）",
      "category": "work",
      "duration": 30,
      "startTime": "14:00",
      "date": "today" 或 "tomorrow"
    }
  ]
}`;
}

function buildBreakdownPrompt(title, duration) {
  return `你是一位擅长第一性原理思维的任务规划专家。请用第一性原理对任务进行拆解。

**第一性原理拆解步骤**：
1. 剥离假设：先问「这个任务的本质目标是什么？」，去掉所有习惯性做法
2. 回归基础：找出完成该目标所需的最底层、不可再拆的行动单元
3. 重构执行链：从基础元素出发，重新构建最高效的执行路径

**待拆解的任务**：「${title}」（预计总时长：${duration} 分钟）

**要求**：
- 输出 3-5 个步骤，每步骤的时长之和 ≤ ${duration} 分钟
- 每步骤以动词开头，描述具体行动（≤15字）
- 步骤之间逻辑递进，从最基础的前置动作到最终交付
- 不要照搬常规流程，要从本质出发重构

只返回 JSON，无 Markdown：
[
  {"text": "具体行动描述", "est": 15, "done": false}
]`;
}

// ── SMART 任务优化提示词 ──────────────────────────────────────────────
function buildSmartPrompt(title) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  return `你是任务规划专家，请用 SMART 原则优化用户输入的任务。

**当前时间**：${date} ${time}
**明天**：${tomorrowDate}

**SMART 原则**：
- Specific（具体）：动词+对象+量化标准，如"写完项目周报初稿"
- Measurable（可衡量）：有明确完成标准
- Achievable（可实现）：单次聚焦，时长合理（30-90分钟）
- Relevant（相关）：自动判断类型 work/study/life
- Time-bound（有时限）：给出合理开始时间

**用户原始任务**：「${title}」

只返回 JSON，无 Markdown：
{
  "title": "SMART优化后的标题（≤20字，动词开头）",
  "category": "work",
  "duration": 45,
  "startTime": "14:00",
  "date": "today",
  "smart_tip": "优化说明（≤30字）"
}`;
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
      const today = getLocalDateString();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = getLocalDateString(tomorrow);

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
  const today = getLocalDateString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = getLocalDateString(tomorrow);

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
  if (task.id.includes('_20')) {
    return null;
  }

  const taskDate = new Date(task.date);
  const target = new Date(targetDate);

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
        id: `${s.id}_${targetDate}`,
        done: false
      })) : []
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 能量变化提示组件
// ═══════════════════════════════════════════════════════════════════

function EnergyNotification({ type, amount, visible, onClose }) {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onClose, 2500);
      return () => clearTimeout(timer);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const isRecovery = type === 'recovery';
  const isOvertime = type === 'overtime';
  const color = isRecovery ? '#10b981' : isOvertime ? '#f59e0b' : COLORS.neonBlue;
  const icon = isRecovery ? '🔋' : isOvertime ? '💪' : '⚡';
  const text = isRecovery
    ? `精力恢复 +${amount.toFixed(1)}%`
    : isOvertime
      ? `长时间专注，辛苦了 -${amount.toFixed(1)}%`
      : `精力消耗 -${amount.toFixed(1)}%`;

  return (
    <div style={{
      position: 'fixed',
      bottom: '40px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 24px',
      background: 'rgba(15, 23, 42, 0.8)',
      backdropFilter: 'blur(20px)',
      border: `1px solid ${color}`,
      borderRadius: '12px',
      color: color,
      fontSize: '12px',
      fontWeight: '800',
      zIndex: 5000,
      boxShadow: `0 0 20px ${color}30`,
      letterSpacing: '0.5px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      whiteSpace: 'nowrap'
    }}>
      <span style={{ fontSize: '18px' }}>{icon}</span>
      {text}
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
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartTip, setSmartTip] = useState('');

  const handleSmartOptimize = async () => {
    if (!formData.title.trim() || smartLoading) return;
    setSmartLoading(true);
    setSmartTip('');
    try {
      const result = await callAI(formData.title, () => buildSmartPrompt(formData.title));
      if (result && !Array.isArray(result)) {
        const today = getLocalDateString();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = getLocalDateString(tomorrow);
        const targetDate = result.date === 'tomorrow' ? tomorrowDate : today;
        setFormData(prev => ({
          ...prev,
          title: result.title || prev.title,
          category: ['work', 'study', 'life'].includes(result.category) ? result.category : prev.category,
          duration: typeof result.duration === 'number' ? result.duration : prev.duration,
          startTime: result.startTime || prev.startTime,
          date: targetDate || prev.date
        }));
        if (result.smart_tip) setSmartTip(result.smart_tip);
      }
    } catch (e) {
      console.error('SMART optimize error:', e);
    }
    setSmartLoading(false);
  };

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
      background: 'rgba(5, 7, 10, 0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center',
      justifyContent: 'center',
      zIndex: 5000,
      padding: isMobile ? '0' : '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(30px)',
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: isMobile ? '24px 24px 0 0' : '20px',
        padding: isMobile ? '32px' : '40px',
        maxHeight: isMobile ? '95vh' : '90vh',
        marginTop: isMobile ? 'auto' : '0',
        overflowY: 'auto',
        boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 20px ${COLORS.shadow}`,
        position: 'relative'
      }}>
        {/* 发光装饰线 */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: '10%',
          right: '10%',
          height: '1px',
          background: `linear-gradient(90deg, transparent, ${COLORS.neonBlue}, transparent)`,
          opacity: 0.5
        }} />

        <h2 style={{
          fontSize: '22px',
          fontWeight: '600',
          color: COLORS.textMain,
          marginBottom: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          letterSpacing: '0.5px'
        }}>
          <span style={{
            color: COLORS.neonBlue,
            textShadow: `0 0 10px ${COLORS.neonBlue}40`
          }}>
            {isNew ? '✦' : '✏️'}
          </span>
          {isNew ? '创建新任务' : '编辑任务详情'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* 任务名称 */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              color: COLORS.textSecondary,
              marginBottom: '10px',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}>
              任务内容
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="在想什么？"
              autoFocus
              required
              style={{
                width: '100%',
                padding: '14px 18px',
                fontSize: '15px',
                color: COLORS.textMain,
                background: 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${COLORS.glassBorder}`,
                borderRadius: '12px',
                outline: 'none',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = COLORS.neonBlue;
                e.target.style.boxShadow = `0 0 15px ${COLORS.neonBlue}20`;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = COLORS.glassBorder;
                e.target.style.boxShadow = 'none';
              }}
            />

            {/* SMART 优化按钮 */}
            {isNew && (
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSmartOptimize}
                  disabled={smartLoading || !formData.title.trim()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: smartLoading || !formData.title.trim() ? COLORS.textSecondary : COLORS.neonBlue,
                    background: smartLoading || !formData.title.trim()
                      ? 'rgba(255,255,255,0.03)'
                      : `rgba(0, 242, 255, 0.08)`,
                    border: `1px solid ${smartLoading || !formData.title.trim() ? COLORS.glassBorder : COLORS.neonBlue + '50'}`,
                    borderRadius: '8px',
                    cursor: smartLoading || !formData.title.trim() ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    letterSpacing: '0.3px'
                  }}
                  onMouseOver={(e) => {
                    if (!smartLoading && formData.title.trim()) {
                      e.currentTarget.style.background = `rgba(0, 242, 255, 0.15)`;
                      e.currentTarget.style.boxShadow = `0 0 12px rgba(0, 242, 255, 0.2)`;
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = smartLoading || !formData.title.trim() ? 'rgba(255,255,255,0.03)' : `rgba(0, 242, 255, 0.08)`;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {smartLoading ? (
                    <>
                      <span style={{
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        border: `2px solid ${COLORS.neonBlue}40`,
                        borderTopColor: COLORS.neonBlue,
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                      }} />
                      AI 分析中...
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      SMART 自动优化
                    </>
                  )}
                </button>
                {smartTip && (
                  <span style={{
                    fontSize: '11px',
                    color: COLORS.neonBlue,
                    opacity: 0.8,
                    fontStyle: 'italic',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>💡 {smartTip}</span>
                )}
              </div>
            )}
          </div>

          {/* 分类 */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              color: COLORS.textSecondary,
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}>
              任务类型
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormData({ ...formData, category: key })}
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: formData.category === key ? '#fff' : COLORS.textSecondary,
                    background: formData.category === key
                      ? `linear-gradient(135deg, ${cat.color}, ${cat.color}dd)`
                      : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${formData.category === key ? 'transparent' : COLORS.glassBorder}`,
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: formData.category === key ? `0 4px 15px ${cat.color}40` : 'none'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '28px'
          }}>
            {/* 时长 */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                预计用时
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={formData.duration}
                  onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 30 })}
                  min="5"
                  style={{
                    width: '100%',
                    padding: '14px 18px',
                    fontSize: '15px',
                    color: COLORS.textMain,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${COLORS.glassBorder}`,
                    borderRadius: '12px',
                    outline: 'none'
                  }}
                />
                <span style={{
                  position: 'absolute',
                  right: '18px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '12px',
                  color: COLORS.textSecondary
                }}>min</span>
              </div>
            </div>

            {/* 日期 */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                执行日期
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: '15px',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '12px',
                  outline: 'none',
                  colorScheme: 'dark'
                }}
              />
            </div>
          </div>

          {/* 开始时间和截止时间 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '28px'
          }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                起始时刻
              </label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: '15px',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '12px',
                  outline: 'none',
                  colorScheme: 'dark'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                截止时刻
              </label>
              <input
                type="time"
                value={formData.deadline}
                onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: '15px',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '12px',
                  outline: 'none',
                  colorScheme: 'dark'
                }}
              />
            </div>
          </div>

          {/* 提醒与重复 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '32px'
          }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                系统提醒
              </label>
              <select
                value={formData.reminder}
                onChange={(e) => setFormData({ ...formData, reminder: e.target.value })}
                style={{
                  width: '100%',
                  padding: '14px 40px 14px 18px',
                  fontSize: '14px',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '12px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">无提醒</option>
                <option value="0">即刻开始</option>
                <option value="5">提前 5 分钟</option>
                <option value="15">提前 15 分钟</option>
                <option value="30">提前 30 分钟</option>
              </select>
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                周期循环
              </label>
              <select
                value={formData.repeat}
                onChange={(e) => setFormData({ ...formData, repeat: e.target.value })}
                style={{
                  width: '100%',
                  padding: '14px 40px 14px 18px',
                  fontSize: '14px',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '12px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="none">单次任务</option>
                <option value="daily">每日重复</option>
                <option value="weekdays">法定工作日</option>
                <option value="weekly">每周固定</option>
              </select>
            </div>
          </div>

          {/* 按钮 */}
          <div style={{
            display: 'flex',
            gap: '16px',
            marginTop: '12px'
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '16px',
                fontSize: '14px',
                fontWeight: '600',
                color: COLORS.textSecondary,
                background: 'transparent',
                border: `1px solid ${COLORS.glassBorder}`,
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
              onMouseOut={(e) => e.target.style.background = 'transparent'}
            >
              放弃
            </button>
            <button
              type="submit"
              style={{
                flex: 2,
                padding: '16px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#fff',
                background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                border: 'none',
                borderRadius: '14px',
                cursor: 'pointer',
                boxShadow: `0 8px 20px ${COLORS.neonBlue}30`,
                transition: 'all 0.3s ease',
                letterSpacing: '0.5px'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = `0 12px 25px ${COLORS.neonBlue}50`;
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = `0 8px 20px ${COLORS.neonBlue}30`;
              }}
            >
              {isNew ? '确认创建' : '同步更新'}
            </button>
          </div>
        </form>

        <style jsx>{`
          select {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 18px center;
            transition: all 0.3s ease;
          }
          select:focus {
            background-color: rgba(255, 255, 255, 0.05) !important;
            border-color: ${COLORS.neonBlue}40 !important;
            box-shadow: 0 0 15px ${COLORS.neonBlue}10;
          }
          option {
             background-color: #0f172a; /* 深色背景 */
             color: #f8fafc;
             padding: 12px;
             cursor: pointer;
           }
         `}</style>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 子任务编辑模态框
// ═══════════════════════════════════════════════════════════════════

function SubtaskModal({ subtask, onSave, onDelete, onClose, isMobile = false }) {
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
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center',
      justifyContent: 'center',
      zIndex: 6000,
      padding: isMobile ? 0 : '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'rgba(13,20,38,0.95)',
        backdropFilter: 'blur(30px)',
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: isMobile ? '24px 24px 0 0' : '16px',
        padding: isMobile ? '32px 24px env(safe-area-inset-bottom)' : '24px',
        boxShadow: `0 20px 50px rgba(0,0,0,0.5)`
      }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: '600',
          color: '#f1f5f9',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ color: COLORS.neonBlue }}>✏️</span> 编辑子任务
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

  if (status === 'loading') {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.bg,
        color: COLORS.neonBlue
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: `3px solid ${COLORS.neonBlue}20`,
            borderTop: `3px solid ${COLORS.neonBlue}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <div style={{ fontSize: '12px', fontWeight: '800', letterSpacing: '2px' }}>正在加载系统...</div>
        </div>
      </div>
    );
  }

  if (!session) {
    // 这里的 UI 已废弃，系统会通过 next-auth 配置重定向到 /auth/signin
    return null;
  }

  return <MindFlowApp userId={session.user.id} />;
}

function MindFlowApp({ userId }) {
  // ========== 基础状态 ==========
  const [tasks, setTasks] = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [viewMonth, setViewMonth] = useState(new Date());
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  // ========== 模态框状态 ==========
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingSubtask, setEditingSubtask] = useState(null);
  const [showEnergyDetail, setShowEnergyDetail] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');

  // ========== 精力系统状态 ==========
  const [energyLevel, setEnergyLevel] = useState(100);
  const [isFocusing, setIsFocusing] = useState(false);
  const [focusTask, setFocusTask] = useState(null);
  const [phase, setPhase] = useState(0);
  const [energyNotification, setEnergyNotification] = useState({ visible: false, type: '', amount: 0 });

  // ========== 过滤器状态 ==========
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskSort, setTaskSort] = useState('time');

  // ========== 语音状态 ==========
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  const loadedDateRef = useRef(selectedDate);

  // 初始化与日期切换加载
  useEffect(() => {
    // 权限申请
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }

    const data = loadAllData(userId);
    const dayData = data[selectedDate] || { tasks: [], energy: 100, messages: [] };

    // ID 修复逻辑：确保所有任务都有唯一 ID
    const repairedTasks = (dayData.tasks || []).map((t, i) => {
      if (!t.id || t.id.startsWith('ai_1')) {
        return { ...t, id: `repair_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}` };
      }
      return t;
    });

    setTasks(repairedTasks);

    // ── 离线补偿：若离线超过 4 小时，精力自动恢复至 100% ──
    const energyData = getEnergyData(userId);
    const offlineCheck = checkOfflineRecovery(energyData);
    if (offlineCheck?.shouldRecover) {
      console.log(`😴 离线 ${offlineCheck.hoursGone}h，精力已自动恢复至 100%`);
      const updated = { ...energyData, level: offlineCheck.newLevel, lastActiveTime: Date.now(), lastUpdateTime: Date.now() };
      saveEnergyData(userId, updated);
      setEnergyLevel(offlineCheck.newLevel);
    } else {
      setEnergyLevel(dayData.energy ?? 100);
    }

    // 更新当前已加载的日期引用，防止保存逻辑错误覆盖
    loadedDateRef.current = selectedDate;
  }, [userId, selectedDate]);

  const checkMobile = () => setIsMobile(window.innerWidth <= 768);
  useEffect(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 定时检查提醒和超时 (仅针对今天)
  useEffect(() => {
    if (selectedDate !== TODAY) return;

    const timer = setInterval(() => {
      checkReminders(tasks);

      // 超时检测
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      setTasks(prev => prev.map(t => {
        if (t.done || !t.startTime) return t;
        const [h, m] = t.startTime.split(':').map(Number);
        const taskMinutes = h * 60 + m;

        // 如果是过去的日期，或者今天且超过15分钟
        const isPastDate = t.date < TODAY;
        const isTodayLate = t.date === TODAY && (currentMinutes - taskMinutes > 15);

        if (!t.isOverdue && (isPastDate || isTodayLate)) {
          // 第一步：询问是否延后
          if (confirm(`任务「${t.title}」已超时，是否延后到明天？`)) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            updateTask(t.id, { date: getLocalDateString(tomorrow), isOverdue: false });
          } else {
            // 第二步：如果拒绝延后，询问是否直接完成
            if (confirm(`既然不延后，是否直接将任务「${t.title}」标记为已完成？`)) {
              toggleTask(t.id);
              updateTask(t.id, { isOverdue: false });
            }
          }
          return { ...t, isOverdue: true };
        }
        return t;
      }));
    }, 60000);
    return () => clearInterval(timer);
  }, [tasks, selectedDate]);

  // 动画帧
  useEffect(() => {
    let frame;
    const animate = () => {
      setPhase(p => p + 1);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, []);

  // 语音识别初始化
  useEffect(() => {
    if (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'zh-CN';

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  // 保存数据 - 仅当数据变化且日期匹配时保存
  useEffect(() => {
    // 确保我们只在 tasks 对应 selectedDate 时保存，避免切换日期时的竞态条件覆盖数据
    if (userId && loadedDateRef.current === selectedDate) {
      saveDateData(userId, selectedDate, { tasks, energy: energyLevel, messages });
    }
  }, [tasks, energyLevel, messages, userId, selectedDate]);

  // ========== 核心操作 ==========
  const handleSend = async () => {
    if (!input.trim() || thinking) return;

    const userMsg = { id: Date.now(), role: 'user', text: input, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setThinking(true);

    const result = await callAI(input, () => buildSystemPrompt(tasks));

    if (result) {
      const aiMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        text: result.summary,
        tasks: result.tasks,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
    }
    setThinking(false);
  };

  const confirmTasks = (msgId, newTasks) => {
    const data = loadAllData(userId);

    newTasks.forEach(newTask => {
      const targetDate = newTask.date;
      const dateData = data[targetDate] || { tasks: [], energy: 100, messages: [] };

      // 避免重复
      const exists = dateData.tasks.some(t => t.title === newTask.title && t.startTime === newTask.startTime);
      if (!exists) {
        dateData.tasks.push(newTask);
        saveDateData(userId, targetDate, dateData);

        // 如果正是当前选中的日期，同步更新 state
        if (targetDate === selectedDate) {
          setTasks(prev => [...prev, newTask]);
        }
      }
    });

    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, tasksAdded: true } : m));
  };

  const toggleTask = (id) => {
    const now = Date.now();
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        const newDone = !t.done;
        if (newDone) {
          // ── 异步结算：根据 duration 和 category 权重一次性扣除精力 ──
          const { drained, isOvertime, message } = calcTaskCompletionDrain(t, now);
          const newLevel = drainEnergy(userId, drained, `完成任务: ${t.title}`);
          if (newLevel !== undefined) setEnergyLevel(newLevel);

          if (isOvertime && message) {
            // 时间溢出：显示专属提示
            setEnergyNotification({ visible: true, type: 'overtime', amount: drained });
          } else {
            setEnergyNotification({ visible: true, type: 'drain', amount: drained });
          }
          setTimeout(() => setEnergyNotification(n => ({ ...n, visible: false })), 3000);
        }
        return { ...t, done: newDone };
      }
      return t;
    }));
  };

  const updateTask = (id, updates) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        // 如果任务被修改了时间或日期，或者明确设置了 isOverdue: false，则重置超时标记
        const isTimeUpdated = updates.startTime !== undefined || updates.date !== undefined;
        return {
          ...t,
          ...updates,
          isOverdue: isTimeUpdated ? false : (updates.isOverdue ?? t.isOverdue)
        };
      }
      return t;
    }));
  };

  const updateSubtask = (taskId, subId, updates) => {
    setTasks(prev => {
      const newTasks = prev.map(t => {
        if (t.id === taskId) {
          const updatedTask = {
            ...t,
            subtasks: t.subtasks.map(s => s.id === subId ? { ...s, ...updates } : s)
          };
          // 如果当前任务是专注任务，也更新 focusTask
          if (focusTask?.id === taskId) {
            setFocusTask(updatedTask);
          }
          return updatedTask;
        }
        return t;
      });
      return newTasks;
    });
    setEditingSubtask(null);
  };

  const deleteSubtask = (taskId, subId) => {
    if (confirm('确定要删除这个子任务吗？')) {
      setTasks(prev => {
        const newTasks = prev.map(t => {
          if (t.id === taskId) {
            const updatedTask = {
              ...t,
              subtasks: t.subtasks.filter(s => s.id !== subId)
            };
            // 如果当前任务是专注任务，也更新 focusTask
            if (focusTask?.id === taskId) {
              setFocusTask(updatedTask);
            }
            return updatedTask;
          }
          return t;
        });
        return newTasks;
      });
      setEditingSubtask(null);
    }
  };

  const deleteTask = (id) => {
    if (confirm('确定要删除这个任务吗？')) {
      setTasks(prev => prev.map(t => {
        if (t.id === id) {
          // 如果删除了正在专注的任务，停止专注
          if (isFocusing && focusTask?.id === id) {
            setIsFocusing(false);
            setFocusTask(null);
          }
          return null;
        }
        return t;
      }).filter(Boolean));
    }
  };

  const addManualTask = (formData) => {
    const targetDate = formData.date || selectedDate;
    const newTask = {
      id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      ...formData,
      done: false,
      subtasks: []
    };

    // 如果日期匹配，更新当前 state，否则直接保存到对应日期
    if (targetDate === selectedDate) {
      setTasks(prev => [...prev, newTask]);
    } else {
      const data = loadAllData(userId);
      const dateData = data[targetDate] || { tasks: [], energy: 100, messages: [] };
      dateData.tasks.push(newTask);
      saveDateData(userId, targetDate, dateData);
    }

    setShowAddModal(false);
  };

  const breakdownTask = async (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    setThinking(true);
    const subtasks = await callAI(`拆解任务：${task.title}`, () => buildBreakdownPrompt(task.title, task.duration));
    if (subtasks) {
      const updatedTask = { ...task, subtasks };
      updateTask(id, { subtasks });
      if (focusTask?.id === id) {
        setFocusTask(updatedTask);
      }
    }
    setThinking(false);
  };

  const toggleSubtask = (taskId, subId) => {
    setTasks(prev => {
      const newTasks = prev.map(t => {
        if (t.id === taskId) {
          const updatedTask = {
            ...t,
            subtasks: t.subtasks.map(s => s.id === subId ? { ...s, done: !s.done } : s)
          };
          if (focusTask?.id === taskId) {
            setFocusTask(updatedTask);
          }
          return updatedTask;
        }
        return t;
      });
      return newTasks;
    });
  };

  const startFocus = (task) => {
    setFocusTask(task);
    setIsFocusing(true);
    setActiveTab('chat'); // 自动切换到对话区看状态
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  // 过滤器逻辑
  const getFilteredTasks = useMemo(() => {
    let filtered = [...tasks];

    if (taskFilter === 'pending') filtered = filtered.filter(t => !t.done);
    if (taskFilter === 'done') filtered = filtered.filter(t => t.done);

    return filtered.sort((a, b) => {
      if (taskSort === 'time') {
        const timeA = a.startTime || '99:99';
        const timeB = b.startTime || '99:99';
        return timeA.localeCompare(timeB);
      }
      if (taskSort === 'category') return a.category.localeCompare(b.category);
      return 0;
    });
  }, [tasks, taskFilter, taskSort]);

  const stats = useMemo(() => {
    const doneTasks = tasks.filter(t => t.done);
    const focusTotal = doneTasks.reduce((sum, t) => sum + (Number(t.duration) || 30), 0);
    return {
      total: tasks.length,
      done: doneTasks.length,
      pending: tasks.filter(t => !t.done).length,
      focusMinutes: focusTotal
    };
  }, [tasks]);

  // 日历逻辑
  const changeMonth = (offset) => {
    const next = new Date(viewMonth);
    next.setMonth(next.getMonth() + offset);
    setViewMonth(next);
  };

  const getCalendarDays = () => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days = [];
    const startOffset = firstDay.getDay();

    // 填充月初空白
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, -i);
      days.unshift({ date: getLocalDateString(d), day: d.getDate(), isCurrentMonth: false });
    }

    // 填充当月
    const allData = loadAllData(userId);
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const dateObj = new Date(year, month, i);
      const dateStr = getLocalDateString(dateObj);
      const dayData = allData[dateStr] || { tasks: [] };
      days.push({
        date: dateStr,
        day: i,
        isCurrentMonth: true,
        isToday: dateStr === TODAY,
        isSelected: dateStr === selectedDate,
        completed: dayData.tasks?.filter(t => t.done).length || 0,
        total: dayData.tasks?.length || 0
      });
    }

    return days;
  };

  const calculateStreak = () => {
    const allData = loadAllData(userId);
    let currentStreak = 0;
    let checkDate = new Date();

    while (true) {
      const dateStr = getLocalDateString(checkDate);
      const dayData = allData[dateStr];
      const isDone = dayData?.tasks?.length > 0 && dayData.tasks.every(t => t.done);

      if (isDone) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // 如果不是今天且没完成，中断；如果是今天且没完成，继续看昨天
        if (dateStr === TODAY) {
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
        break;
      }
    }
    return currentStreak;
  };

  const calendar = useMemo(() => getCalendarDays(), [viewMonth, selectedDate, tasks, userId]);
  const streak = useMemo(() => calculateStreak(), [tasks, userId]);

  const navHeight = isMobile ? '70px' : '0px';

  return (
    <div style={{
      height: '100vh',
      height: '100dvh', // 使用动态视口高度适配移动端
      overflow: 'hidden',
      background: COLORS.bg,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: COLORS.textMain,
      position: 'relative'
    }}>
      {/* 装饰性背景 */}
      <div style={{
        position: 'fixed',
        top: '-10%',
        right: '-10%',
        width: '40%',
        height: '40%',
        background: `radial-gradient(circle, ${COLORS.neonBlue}15, transparent 70%)`,
        filter: 'blur(80px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'fixed',
        bottom: '-10%',
        left: '-10%',
        width: '30%',
        height: '30%',
        background: `radial-gradient(circle, ${COLORS.accent}10, transparent 70%)`,
        filter: 'blur(60px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      {/* 移动端 Tab 切换 - 移至底部 */}
      {isMobile && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(30px)',
          borderTop: `1px solid ${COLORS.glassBorder}`,
          padding: '12px 20px env(safe-area-inset-bottom)', // 适配全面屏底部安全区
          gap: '16px',
          zIndex: 1000,
          boxShadow: '0 -10px 30px rgba(0,0,0,0.5)'
        }}>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '12px',
              background: activeTab === 'chat' ? `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})` : 'transparent',
              color: activeTab === 'chat' ? '#fff' : COLORS.textSecondary,
              border: 'none',
              fontSize: '13px',
              fontWeight: '700',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <span style={{ fontSize: '18px' }}>💬</span>
            AI助手
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '12px',
              background: activeTab === 'tasks' ? `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})` : 'transparent',
              color: activeTab === 'tasks' ? '#fff' : COLORS.textSecondary,
              border: 'none',
              fontSize: '13px',
              fontWeight: '700',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <span style={{ fontSize: '18px' }}>📋</span>
            任务清单
          </button>
        </div>
      )}

      {/* 左侧：AI 对话 */}
      <div style={{
        width: isMobile ? '100%' : '400px', // 适当增加宽度，配合更小的能量球
        height: isMobile ? `calc(100% - ${navHeight})` : '100%',
        display: (isMobile && activeTab !== 'chat') ? 'none' : 'flex',
        borderRight: isMobile ? 'none' : `1px solid ${COLORS.glassBorder}`,
        flexDirection: 'column',
        background: 'rgba(15, 23, 42, 0.3)',
        backdropFilter: 'blur(10px)',
        overflow: 'hidden',
        zIndex: 1,
        paddingBottom: isMobile ? '20px' : '0'
      }}>
        {/* 头部 */}
        <div style={{
          padding: isMobile ? '10px 16px' : '16px 20px', // 进一步减小内边距
          borderBottom: `1px solid ${COLORS.glassBorder}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: isMobile ? '32px' : '36px', // 减小尺寸
              height: isMobile ? '32px' : '36px',
              borderRadius: '10px',
              background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isMobile ? '18px' : '20px',
              boxShadow: `0 4px 15px ${COLORS.neonBlue}30`,
              position: 'relative',
              overflow: 'hidden'
            }}>
              <span style={{ color: '#fff', zIndex: 1 }}>✦</span>
            </div>
            <div>
              <h1 style={{
                fontSize: isMobile ? '14px' : '16px', // 减小字号
                fontWeight: '800',
                color: COLORS.textMain,
                margin: '0',
                letterSpacing: '1px',
                lineHeight: 1
              }}>
                MINDFLOW
              </h1>
              <p style={{
                fontSize: '8px', // 减小字号
                color: COLORS.neonBlue,
                margin: '2px 0 0',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                opacity: 0.8
              }}>
                NEURO-ASSISTANT v4.0
              </p>
            </div>
          </div>
          <UserProfile />
        </div>

        {/* 能量球区域 */}
        <div
          onClick={() => setShowEnergyDetail(true)}
          style={{
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.3s ease',
            position: 'relative'
          }}
          onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.2)'}
          onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
        >
          <EnergyOrb energyLevel={energyLevel} phase={phase} tasks={tasks} isMobile={isMobile} />
        </div>

        {/* 消息列表 */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}>
          {messages.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: COLORS.textSecondary,
              opacity: 0.6
            }}>
              <div style={{
                fontSize: '48px',
                marginBottom: '20px',
                filter: `drop-shadow(0 0 10px ${COLORS.neonBlue}40)`
              }}>📡</div>
              <p style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: '700', color: COLORS.textMain }}>
                告诉我你今天要做什么
              </p>
              <p style={{ margin: 0, fontSize: '11px', color: COLORS.textSecondary, letterSpacing: '1px', opacity: 0.8 }}>
                我会帮你整理成任务清单
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                width: '100%'
              }}>
                <div style={{
                  maxWidth: '85%',
                  background: msg.role === 'user'
                    ? `linear-gradient(135deg, ${COLORS.neonBlue}20, ${COLORS.accent}20)`
                    : 'rgba(255, 255, 255, 0.03)',
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${msg.role === 'user' ? COLORS.neonBlue + '40' : COLORS.glassBorder}`,
                  borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                  padding: '16px 20px',
                  position: 'relative',
                  boxShadow: msg.role === 'user' ? `0 4px 15px ${COLORS.neonBlue}15` : 'none'
                }}>
                  <div style={{
                    fontSize: '10px',
                    fontWeight: '800',
                    color: msg.role === 'user' ? COLORS.neonBlue : COLORS.textSecondary,
                    marginBottom: '8px',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '20px'
                  }}>
                    <span>{msg.role === 'user' ? '用户' : 'AI'}</span>
                    <span style={{ opacity: 0.6 }}>{msg.time}</span>
                  </div>

                  <div style={{
                    fontSize: '14px',
                    color: COLORS.textMain,
                    lineHeight: '1.6',
                    letterSpacing: '0.3px'
                  }}>
                    {msg.text}
                  </div>

                  {msg.tasks && msg.tasks.length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: '700',
                        color: COLORS.neonBlue,
                        marginBottom: '12px',
                        letterSpacing: '0.5px',
                        borderBottom: `1px solid ${COLORS.neonBlue}20`,
                        paddingBottom: '8px'
                      }}>
                        识别到以下任务 [{msg.tasks.length}]
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {msg.tasks.map((task, i) => {
                          const cat = CATEGORIES[task.category];
                          return (
                            <div key={i} style={{
                              padding: '12px',
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: `1px solid ${COLORS.glassBorder}`,
                              borderRadius: '12px',
                              fontSize: '13px'
                            }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginBottom: '6px'
                              }}>
                                <span style={{
                                  color: cat.color,
                                  textShadow: `0 0 8px ${cat.color}40`
                                }}>{cat.icon}</span>
                                <span style={{ color: COLORS.textMain, fontWeight: '600' }}>
                                  {task.title}
                                </span>
                              </div>
                              <div style={{
                                fontSize: '10px',
                                color: COLORS.textSecondary,
                                display: 'flex',
                                gap: '12px',
                                fontWeight: '600',
                                textTransform: 'uppercase'
                              }}>
                                <span style={{ color: cat.color }}>{cat.label}</span>
                                <span>{task.duration}m</span>
                                {task.startTime && <span>@{task.startTime}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => confirmTasks(msg.id, msg.tasks)}
                        disabled={msg.tasksAdded}
                        style={{
                          width: '100%',
                          padding: '12px',
                          marginTop: '12px',
                          background: msg.tasksAdded
                            ? 'rgba(255, 255, 255, 0.05)'
                            : `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                          border: msg.tasksAdded ? `1px solid ${COLORS.glassBorder}` : 'none',
                          borderRadius: '12px',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: '800',
                          cursor: msg.tasksAdded ? 'not-allowed' : 'pointer',
                          letterSpacing: '1px',
                          transition: 'all 0.3s ease',
                          boxShadow: msg.tasksAdded ? 'none' : `0 4px 15px ${COLORS.neonBlue}40`
                        }}
                      >
                        {msg.tasksAdded ? '已同步到清单' : '添加到任务'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 输入框 */}
        <div style={{
          padding: '24px',
          borderTop: `1px solid ${COLORS.glassBorder}`,
          background: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(20px)'
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${isListening ? COLORS.neonBlue : COLORS.glassBorder}`,
            borderRadius: '16px',
            padding: '12px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: isListening ? `0 0 20px ${COLORS.neonBlue}20` : 'none'
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
              placeholder={isListening ? '正在聆听指令...' : '告诉我你要做什么...'}
              disabled={thinking}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: COLORS.textMain,
                fontSize: '14px',
                padding: '8px',
                resize: 'none',
                maxHeight: '200px',
                overflowY: 'auto',
                lineHeight: '1.6',
                letterSpacing: '0.5px'
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
                title={isListening ? '停止' : '语音输入'}
                style={{
                  background: isListening ? `${COLORS.neonBlue}20` : 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid ${isListening ? COLORS.neonBlue : 'transparent'}`,
                  borderRadius: '10px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isListening ? COLORS.neonBlue : COLORS.textSecondary,
                  transition: 'all 0.3s ease'
                }}
              >
                <span style={{ fontSize: '18px' }}>{isListening ? '🛰️' : '🎤'}</span>
              </button>

              <button
                onClick={handleSend}
                disabled={thinking || !input.trim()}
                style={{
                  padding: isMobile ? '10px 24px' : '8px 20px',
                  background: thinking || !input.trim()
                    ? 'rgba(255, 255, 255, 0.05)'
                    : `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                  border: 'none',
                  borderRadius: '10px',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: '800',
                  cursor: thinking || !input.trim() ? 'not-allowed' : 'pointer',
                  opacity: thinking || !input.trim() ? 0.5 : 1,
                  letterSpacing: '1px',
                  transition: 'all 0.3s ease',
                  boxShadow: thinking || !input.trim() ? 'none' : `0 4px 12px ${COLORS.neonBlue}40`,
                  position: 'relative'
                }}
              >
                {thinking ? (
                  <span className="thinking-glitch">正在处理...</span>
                ) : (isMobile ? '发送' : '确认发送')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：任务列表 */}
      <div style={{
        flex: 1,
        height: isMobile ? 'calc(100% - 70px)' : '100%',
        display: (isMobile && activeTab !== 'tasks') ? 'none' : 'flex',
        flexDirection: 'column',
        padding: isMobile ? '20px' : '40px',
        overflowY: 'auto',
        background: 'transparent',
        zIndex: 1,
        position: 'relative'
      }}>
        {/* 统计卡片 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: isMobile ? '16px' : '20px',
          marginBottom: '32px'
        }}>
          {[
            {
              label: '任务负载',
              value: stats.total,
              color: COLORS.neonBlue,
              icon: '📊',
              detail: `${Math.round(stats.done / stats.total * 100 || 0)}% 已完成`
            },
            {
              label: '已归档',
              value: stats.done,
              color: '#10b981',
              icon: '⚡',
              detail: `剩余: ${stats.pending} 项`
            },
            {
              label: '活跃进程',
              value: stats.pending,
              color: '#f59e0b',
              icon: '🛰️',
              detail: tasks.filter(t => !t.done && t.startTime).length > 0
                ? `下一项: ${tasks.filter(t => !t.done && t.startTime).sort((a, b) =>
                  (a.startTime || '').localeCompare(b.startTime || '')
                )[0]?.startTime}`
                : '待机中'
            },
            {
              label: '心流时长',
              value: `${stats.focusMinutes}m`,
              color: '#8b5cf6',
              icon: '🌀',
              detail: `效率指数 ${Math.round(stats.focusMinutes / 6)}%`
            }
          ].map((stat, i) => (
            <div key={i} style={{
              padding: '24px',
              background: 'rgba(255, 255, 255, 0.03)',
              backdropFilter: 'blur(10px)',
              border: `1px solid ${COLORS.glassBorder}`,
              borderRadius: '20px',
              transition: 'all 0.3s ease',
              cursor: 'default',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: 0, right: 0, width: '40px', height: '40px',
                background: `radial-gradient(circle at top right, ${stat.color}15, transparent)`,
              }} />
              <div style={{ fontSize: '20px', marginBottom: '12px', opacity: 0.8 }}>
                {stat.icon}
              </div>
              <div style={{
                fontSize: '28px',
                fontWeight: '800',
                color: stat.color,
                marginBottom: '6px',
                letterSpacing: '-0.5px',
                textShadow: `0 0 15px ${stat.color}30`
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '11px',
                color: COLORS.textSecondary,
                marginBottom: '4px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {stat.label}
              </div>
              <div style={{
                fontSize: '10px',
                color: stat.color,
                fontWeight: '700',
                letterSpacing: '1px',
                opacity: 0.8
              }}>
                {stat.detail}
              </div>
            </div>
          ))}
        </div>

        {/* 打卡日历 (月视图) */}
        <div style={{
          padding: isMobile ? '16px' : '24px',
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${COLORS.glassBorder}`,
          borderRadius: '24px',
          marginBottom: '32px',
          boxShadow: `0 4px 24px -1px rgba(0, 0, 0, 0.2)`
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: isMobile ? '16px' : '24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
              <h3 style={{
                fontSize: isMobile ? '14px' : '16px',
                fontWeight: '700',
                color: COLORS.textMain,
                margin: 0,
                letterSpacing: '0.5px'
              }}>
                <span style={{ color: COLORS.neonBlue, marginRight: '8px' }}>●</span>
                {viewMonth.getFullYear()} / {viewMonth.getMonth() + 1}
              </h3>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => changeMonth(-1)}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${COLORS.glassBorder}`,
                    borderRadius: '6px',
                    color: COLORS.textSecondary,
                    cursor: 'pointer',
                    fontSize: '10px'
                  }}
                >
                  ◀
                </button>
                <button
                  onClick={() => changeMonth(1)}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${COLORS.glassBorder}`,
                    borderRadius: '6px',
                    color: COLORS.textSecondary,
                    cursor: 'pointer',
                    fontSize: '10px'
                  }}
                >
                  ▶
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px' }}>
              {!isMobile && (
                <div style={{
                  fontSize: '11px',
                  color: '#10b981',
                  fontWeight: '700',
                  background: 'rgba(16, 185, 129, 0.1)',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  letterSpacing: '1px'
                }}>
                  STREAK {streak}D
                </div>
              )}
              <button
                onClick={() => {
                  setSelectedDate(TODAY);
                  setViewMonth(new Date());
                }}
                style={{
                  padding: '6px 10px',
                  fontSize: '10px',
                  fontWeight: '600',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '8px',
                  color: COLORS.neonBlue,
                  cursor: 'pointer'
                }}
              >
                TODAY
              </button>
              <button
                onClick={() => setIsCalendarExpanded(!isCalendarExpanded)}
                style={{
                  padding: '6px 8px',
                  fontSize: '10px',
                  fontWeight: '600',
                  background: 'transparent',
                  border: 'none',
                  color: COLORS.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {isCalendarExpanded ? '▴' : '▾'}
              </button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: isMobile ? '6px' : '10px',
            maxHeight: isCalendarExpanded ? '400px' : (isMobile ? '70px' : '90px'),
            overflow: 'hidden',
            transition: 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => (
              <div key={w} style={{
                textAlign: 'center',
                fontSize: '10px',
                fontWeight: '800',
                color: COLORS.textSecondary,
                paddingBottom: isMobile ? '8px' : '12px',
                opacity: 0.5
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
                  padding: isMobile ? '8px 2px' : '12px 4px',
                  background: day.isSelected
                    ? `rgba(0, 242, 255, 0.15)`
                    : day.completed > 0
                      ? 'rgba(16, 185, 129, 0.05)'
                      : 'transparent',
                  border: day.isSelected
                    ? `1px solid ${COLORS.neonBlue}`
                    : day.isToday
                      ? `1px solid rgba(16, 185, 129, 0.3)`
                      : `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '10px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  opacity: day.isCurrentMonth ? 1 : 0.2,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: day.isSelected ? `0 0 10px ${COLORS.neonBlue}30` : 'none'
                }}
              >
                <div style={{
                  fontSize: isMobile ? '11px' : '13px',
                  fontWeight: day.isSelected || day.isToday ? '800' : '500',
                  color: day.isSelected ? COLORS.neonBlue : day.isToday ? '#10b981' : COLORS.textMain,
                }}>
                  {day.day}
                </div>
                {/* 任务状态指示器 */}
                {day.total > 0 && (
                  <div style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: '2px'
                  }}>
                    <div style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      background: day.completed === day.total ? '#10b981' : COLORS.neonBlue,
                      boxShadow: `0 0 5px ${day.completed === day.total ? '#10b981' : COLORS.neonBlue}`,
                      opacity: 0.8
                    }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 任务列表 */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${COLORS.glassBorder}`,
          borderRadius: '24px',
          padding: isMobile ? '20px' : '32px',
          flex: 1,
          boxShadow: `0 4px 24px -1px rgba(0, 0, 0, 0.2)`
        }}>

          <h2 style={{
            fontSize: '20px',
            fontWeight: '800',
            color: COLORS.textMain,
            marginBottom: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            letterSpacing: '0.5px'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                width: '4px',
                height: '24px',
                background: COLORS.neonBlue,
                borderRadius: '2px',
                boxShadow: `0 0 10px ${COLORS.neonBlue}80`
              }} />
              任务清单
            </span>
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                padding: '10px 20px',
                fontSize: '12px',
                fontWeight: '700',
                color: '#fff',
                background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: `0 4px 15px ${COLORS.neonBlue}40`,
                transition: 'all 0.3s ease',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
              onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
              onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
            >
              <span style={{ fontSize: '16px' }}>+</span> 添加任务
            </button>
          </h2>

          {/* 过滤器 UI */}
          <div style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            {/* 状态过滤按钮组 */}
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '4px',
              borderRadius: '12px',
              border: `1px solid ${COLORS.glassBorder}`
            }}>
              {[
                { value: 'all', label: '全部', icon: '📋' },
                { value: 'pending', label: '进行中', icon: '⏳' },
                { value: 'done', label: '已完成', icon: '✓' }
              ].map(filter => (
                <button
                  key={filter.value}
                  onClick={() => setTaskFilter(filter.value)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '11px',
                    fontWeight: '700',
                    color: taskFilter === filter.value ? '#fff' : COLORS.textSecondary,
                    background: taskFilter === filter.value
                      ? `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`
                      : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    letterSpacing: '1px',
                    boxShadow: taskFilter === filter.value ? `0 4px 12px ${COLORS.neonBlue}40` : 'none'
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* 排序下拉框 */}
            <div style={{ position: 'relative', flex: isMobile ? '1' : 'none' }}>
              <select
                value={taskSort}
                onChange={(e) => setTaskSort(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  paddingRight: '32px',
                  fontSize: '11px',
                  fontWeight: '600',
                  color: COLORS.textMain,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '10px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  letterSpacing: '0.5px'
                }}
              >
                <option value="date">按日期排序</option>
                <option value="time">按时间排序</option>
                <option value="category">按类型排序</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '120px' }}>
            {getFilteredTasks.map((task) => {
              const cat = CATEGORIES[task.category];
              return (
                <div key={task.id} style={{
                  padding: '20px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${task.done ? 'rgba(16, 185, 129, 0.2)' : COLORS.glassBorder}`,
                  borderRadius: '16px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: task.done ? 'none' : `0 4px 12px rgba(0,0,0,0.1)`
                }}>
                  {!task.done && (
                    <div style={{
                      position: 'absolute',
                      top: 0, left: 0, width: '2px', height: '100%',
                      background: cat.color,
                      boxShadow: `0 0 8px ${cat.color}`
                    }} />
                  )}

                  <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'flex-start' : 'center',
                    gap: '16px',
                    marginBottom: task.subtasks?.length > 0 ? '16px' : 0
                  }}>
                    <div style={{ display: 'flex', gap: '16px', width: isMobile ? '100%' : 'auto', alignItems: 'center' }}>
                      <button
                        onClick={() => toggleTask(task.id)}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          border: task.done ? 'none' : `2px solid ${COLORS.glassBorder}`,
                          background: task.done ? '#10b981' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: '#fff',
                          fontSize: '14px',
                          flexShrink: 0,
                          transition: 'all 0.3s ease',
                          boxShadow: task.done ? '0 0 10px rgba(16, 185, 129, 0.4)' : 'none'
                        }}
                      >
                        {task.done && '✓'}
                      </button>

                      <div style={{ flex: 1 }}>
                        <div
                          onClick={() => {
                            setEditingTask(task);
                            setShowEditModal(true);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                        >
                          <span style={{
                            fontSize: '15px',
                            fontWeight: '600',
                            color: task.done ? COLORS.textSecondary : COLORS.textMain,
                            textDecoration: task.done ? 'line-through' : 'none',
                            transition: 'all 0.3s ease',
                            letterSpacing: '0.3px'
                          }}>
                            {task.title}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, width: '100%' }}>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: COLORS.textSecondary, flexWrap: 'wrap' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${COLORS.glassBorder}`,
                          color: cat.color,
                          fontWeight: '700',
                          textTransform: 'uppercase'
                        }}>
                          {cat.label}
                        </span>
                        {task.isOverdue && !task.done && (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '6px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            color: '#ef4444',
                            fontWeight: '700'
                          }}>
                            已超时
                          </span>
                        )}
                        {task.startTime && (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '6px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: `1px solid ${COLORS.glassBorder}`,
                            color: COLORS.neonBlue
                          }}>
                            {task.startTime}
                          </span>
                        )}
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${COLORS.glassBorder}`
                        }}>
                          {task.duration}m
                        </span>
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      gap: '10px',
                      flexShrink: 0,
                      width: isMobile ? '100%' : 'auto',
                      justifyContent: isMobile ? 'space-between' : 'flex-start',
                      marginTop: isMobile ? '8px' : '0'
                    }}>
                      {!task.done && !task.subtasks?.length && (
                        <button
                          onClick={() => breakdownTask(task.id)}
                          style={{
                            flex: isMobile ? 1 : 'none',
                            padding: '8px 14px',
                            background: 'transparent',
                            border: `1px solid ${COLORS.neonBlue}40`,
                            borderRadius: '8px',
                            color: COLORS.neonBlue,
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer'
                          }}
                        >
                          拆解
                        </button>
                      )}
                      {!task.done && (
                        <button
                          onClick={() => startFocus(task)}
                          style={{
                            flex: isMobile ? 1 : 'none',
                            padding: '8px 14px',
                            background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer'
                          }}
                        >
                          专注
                        </button>
                      )}
                      <button
                        onClick={() => deleteTask(task.id)}
                        style={{
                          flex: isMobile ? 1 : 'none',
                          padding: '8px 14px',
                          background: 'transparent',
                          border: `1px solid rgba(239, 68, 68, 0.2)`,
                          borderRadius: '8px',
                          color: '#ef4444',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer'
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {task.subtasks?.length > 0 && (
                    <div style={{ marginLeft: '36px', paddingLeft: '16px', borderLeft: '2px solid rgba(99, 179, 237, 0.2)' }}>
                      {task.subtasks.map((sub, i) => (
                        <div
                          key={sub.id}
                          className="subtask-item"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            marginBottom: '4px',
                            borderRadius: '6px',
                            background: sub.done ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                            transition: 'all 0.2s ease',
                            position: 'relative',
                          }}
                        >
                          <div
                            onClick={() => toggleSubtask(task.id, sub.id)}
                            style={{
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              border: sub.done ? '2px solid #10b981' : '2px solid rgba(99, 179, 237, 0.3)',
                              background: sub.done ? '#10b981' : 'transparent',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              color: '#fff',
                              flexShrink: 0
                            }}
                          >
                            {sub.done && '✓'}
                          </div>
                          <span style={{
                            fontSize: '13px',
                            color: sub.done ? '#94a3b8' : '#cbd5e1',
                            textDecoration: sub.done ? 'line-through' : 'none',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {i + 1}. {sub.text}
                          </span>

                          {/* 子任务操作按钮 */}
                          <div className="subtask-actions" style={{
                            display: 'flex',
                            gap: '8px',
                            opacity: isMobile ? 0.6 : 0,
                            transition: 'opacity 0.2s ease'
                          }}>
                            <button
                              onClick={() => setEditingSubtask({ taskId: task.id, subtask: sub })}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#00f2ff',
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                borderRadius: '4px',
                                opacity: 0.6
                              }}
                              onMouseOver={(e) => e.target.style.opacity = 1}
                              onMouseOut={(e) => e.target.style.opacity = 0.6}
                              title="编辑"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteSubtask(task.id, sub.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ef4444',
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                borderRadius: '4px',
                                opacity: 0.6
                              }}
                              onMouseOver={(e) => e.target.style.opacity = 1}
                              onMouseOut={(e) => e.target.style.opacity = 0.6}
                              title="删除"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: rgba(99, 179, 237, 0.05);
    borderRadius: 4px;
  }
  
  ::-webkit-scrollbar-thumb {
    background: rgba(99, 179, 237, 0.2);
    borderRadius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(99, 179, 237, 0.3);
  }

  @keyframes glitch {
    0% { transform: translate(0); text-shadow: none; }
    20% { transform: translate(-2px, 2px); text-shadow: 2px 0 #00f2ff, -2px 0 #ff0055; }
    40% { transform: translate(-2px, -2px); text-shadow: -2px 0 #00f2ff, 2px 0 #ff0055; }
    60% { transform: translate(2px, 2px); text-shadow: 2px 0 #00f2ff, -2px 0 #ff0055; }
    80% { transform: translate(2px, -2px); text-shadow: -2px 0 #00f2ff, 2px 0 #ff0055; }
    100% { transform: translate(0); text-shadow: none; }
  }
  .thinking-glitch {
    display: inline-block;
    animation: glitch 0.2s infinite;
    font-family: '"JetBrains Mono", monospace';
  }

  .subtask-item:hover .subtask-actions {
    opacity: 1 !important;
  }
  
  .subtask-item:hover {
     background: rgba(255, 255, 255, 0.05) !important;
   }

   select {
     appearance: none;
     background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
     background-repeat: no-repeat;
     background-position: right 12px center;
   }
   
   option {
      background-color: #0f172a;
      color: #f1f5f9;
      cursor: pointer;
    }
  `}</style>

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
          onSave={(updates) => {
            updateTask(editingTask.id, updates);
            setShowEditModal(false);
            setEditingTask(null);
          }}
          onClose={() => {
            setShowEditModal(false);
            setEditingTask(null);
          }}
          defaultDate={selectedDate}
          isMobile={isMobile}
        />
      )}

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
          isMobile={isMobile}
        />
      )}

      {showEnergyDetail && (
        <EnergyDetailModal
          energyLevel={energyLevel}
          tasks={tasks}
          onClose={() => setShowEnergyDetail(false)}
          isMobile={isMobile}
        />
      )}

      <EnergyNotification
        type={energyNotification.type}
        amount={energyNotification.amount}
        visible={energyNotification.visible}
        onClose={() => setEnergyNotification({ ...energyNotification, visible: false })}
      />

      {isFocusing && focusTask && (
        <FocusModal
          task={focusTask}
          onClose={() => {
            setIsFocusing(false);
            setFocusTask(null);
          }}
          onComplete={(id, actualMinutes) => {
            const finalMinutes = actualMinutes || focusTask.duration;
            // 扣除精力：每分钟专注扣除 0.3 点精力 (可根据需求调整)
            const energyCost = Math.round(finalMinutes * 0.3);
            setEnergyLevel(prev => Math.max(0, prev - energyCost));

            // 弹出能效提示
            setEnergyNotification({
              visible: true,
              type: 'cost',
              amount: energyCost
            });
            setTimeout(() => setEnergyNotification(prev => ({ ...prev, visible: false })), 3000);

            toggleTask(id);
            setIsFocusing(false);
            setFocusTask(null);
          }}
          onBreakdown={breakdownTask}
          onToggleSubtask={toggleSubtask}
          onEditSubtask={(sub) => setEditingSubtask({ taskId: focusTask.id, subtask: sub })}
          onDeleteSubtask={(subId) => deleteSubtask(focusTask.id, subId)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 专注模式模态框
// ═══════════════════════════════════════════════════════════════════

function FocusModal({ task, onClose, onComplete, onBreakdown, onToggleSubtask, onEditSubtask, onDeleteSubtask, isMobile = false }) {
  const [timeLeft, setTimeLeft] = useState(task.duration * 60);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isBreakingDown, setIsBreakingDown] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isActive && !isPaused && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isActive, isPaused, timeLeft]);

  useEffect(() => {
    if (timeLeft === 0) {
      setIsActive(false);
      if (confirm('专注时长已到！是否标记任务为完成？系统将扣除相应精力值。')) {
        onComplete(task.id, task.duration);
      }
    }
  }, [timeLeft, task.id, task.duration, onComplete]);

  const handleBreakdown = async () => {
    setIsBreakingDown(true);
    await onBreakdown(task.id);
    setIsBreakingDown(false);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const progress = (timeLeft / (task.duration * 60)) * 100;

  // 计算子任务完成度
  const subtaskProgress = task.subtasks?.length > 0
    ? Math.round((task.subtasks.filter(s => s.done).length / task.subtasks.length) * 100)
    : 0;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(5, 7, 10, 0.98)',
      backdropFilter: 'blur(40px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 4000,
      padding: '20px'
    }}>
      {/* 返回按钮 */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: isMobile ? '20px' : '40px',
          left: isMobile ? '20px' : '40px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: `1px solid ${COLORS.glassBorder}`,
          borderRadius: '12px',
          color: COLORS.textMain,
          padding: '10px 20px',
          fontSize: '14px',
          fontWeight: '600',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.3s ease',
          zIndex: 10
        }}
        onMouseOver={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
        onMouseOut={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.05)'}
      >
        <span>←</span> 返回
      </button>

      {/* 背景动态光晕 */}
      <div style={{
        position: 'absolute',
        width: '600px', height: '600px',
        background: `radial-gradient(circle, ${COLORS.neonBlue}15, transparent 70%)`,
        filter: 'blur(100px)',
        zIndex: 0,
        animation: 'pulse 8s ease-in-out infinite'
      }} />

      <div style={{
        width: '100%',
        maxWidth: '480px',
        textAlign: 'center',
        position: 'relative',
        zIndex: 1
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: '800',
          color: COLORS.neonBlue,
          letterSpacing: '4px',
          marginBottom: '16px',
          textTransform: 'uppercase',
          opacity: 0.8
        }}>
          Deep Focus Session
        </div>

        <h2 style={{
          fontSize: isMobile ? '24px' : '32px',
          fontWeight: '800',
          color: '#fff',
          marginBottom: '32px',
          letterSpacing: '1px'
        }}>
          {task.title}
        </h2>

        {/* 倒计时圆环 */}
        <div className="countdown-ring" style={{
          position: 'relative',
          width: isMobile ? '240px' : '300px',
          height: isMobile ? '240px' : '300px',
          margin: '0 auto 48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {/* 呼吸灯动效 SVG - 增加 viewBox 范围防止发光剪切 */}
          <svg
            viewBox={isMobile ? "-40 -40 320 320" : "-50 -50 400 400"}
            style={{
              position: 'absolute',
              width: '120%',
              height: '120%',
              top: '-10%',
              left: '-10%',
              transform: 'rotate(-90deg)',
              pointerEvents: 'none'
            }}
          >
            <defs>
              <filter id="neon-glow-wide" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
                <feColorMatrix in="blur" type="matrix" values="
                  1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 15 -6" result="glow" />
              </filter>
              <filter id="neon-glow-core" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* 极淡背景轨道 - 虚化边缘 */}
            <circle
              cx={isMobile ? '120' : '150'}
              cy={isMobile ? '120' : '150'}
              r={isMobile ? '110' : '140'}
              fill="none"
              stroke="rgba(0, 242, 255, 0.03)"
              strokeWidth="2"
              style={{ filter: 'blur(2px)' }}
            />

            {/* 宽幅柔和扩散层 - 模拟环境光晕 */}
            <circle
              className="breath-ring-wide"
              cx={isMobile ? '120' : '150'}
              cy={isMobile ? '120' : '150'}
              r={isMobile ? '110' : '140'}
              fill="none"
              stroke={COLORS.neonBlue}
              strokeWidth="6"
              strokeDasharray={isMobile ? '691' : '880'}
              strokeDashoffset={isMobile ? 691 * (1 - progress / 100) : 880 * (1 - progress / 100)}
              strokeLinecap="round"
              style={{
                transition: 'stroke-dashoffset 1s linear',
                filter: 'url(#neon-glow-wide)',
                opacity: 0.3
              }}
            />

            {/* 核心进度环 - 聚焦霓虹感 */}
            <circle
              className="breath-ring-core"
              cx={isMobile ? '120' : '150'}
              cy={isMobile ? '120' : '150'}
              r={isMobile ? '110' : '140'}
              fill="none"
              stroke={COLORS.neonBlue}
              strokeWidth="4"
              strokeDasharray={isMobile ? '691' : '880'}
              strokeDashoffset={isMobile ? 691 * (1 - progress / 100) : 880 * (1 - progress / 100)}
              strokeLinecap="round"
              style={{
                transition: 'stroke-dashoffset 1s linear',
                filter: 'url(#neon-glow-core)',
                opacity: 0.95
              }}
            />
          </svg>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2
          }}>
            <div
              className="timer-text"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: isMobile ? '56px' : '72px',
                fontWeight: '800',
                color: '#fff',
                lineHeight: 1
              }}
            >
              {formatTime(timeLeft)}
            </div>
            {task.subtasks?.length > 0 && (
              <div style={{
                fontSize: '12px',
                fontWeight: '700',
                color: COLORS.neonBlue,
                marginTop: '12px',
                letterSpacing: '2px',
                opacity: 0.8
              }}>
                {subtaskProgress}% COMPLETED
              </div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '24px',
          marginBottom: '40px'
        }}>
          {!isActive ? (
            <button
              onClick={() => setIsActive(true)}
              style={{
                padding: '16px 48px',
                background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                border: 'none',
                borderRadius: '16px',
                color: '#fff',
                fontWeight: '800',
                fontSize: '16px',
                cursor: 'pointer',
                boxShadow: `0 8px 24px ${COLORS.neonBlue}40`,
                letterSpacing: '2px'
              }}
            >
              开始专注
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsPaused(!isPaused)}
                style={{
                  padding: '16px 32px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: `1px solid ${COLORS.glassBorder}`,
                  borderRadius: '16px',
                  color: '#fff',
                  fontWeight: '700',
                  fontSize: '15px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >
                {isPaused ? '继续' : '暂停'}
              </button>
              <button
                onClick={() => {
                  const actualMinutes = Math.ceil((task.duration * 60 - timeLeft) / 60);
                  if (confirm(`确定要提前完成任务吗？系统将根据实际专注时长 (${actualMinutes} 分钟) 扣除精力值。`)) {
                    onComplete(task.id, actualMinutes);
                  }
                }}
                style={{
                  padding: '16px 32px',
                  background: `linear-gradient(135deg, ${COLORS.neonBlue}, ${COLORS.accent})`,
                  border: 'none',
                  borderRadius: '16px',
                  color: '#fff',
                  fontWeight: '700',
                  fontSize: '15px',
                  cursor: 'pointer',
                  flex: 1.5,
                  boxShadow: `0 4px 15px ${COLORS.neonBlue}30`
                }}
              >
                结束专注
              </button>
              <button
                onClick={() => {
                  if (confirm('确定要放弃本次专注吗？')) {
                    onClose();
                  }
                }}
                style={{
                  padding: '16px 24px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '16px',
                  color: '#ef4444',
                  fontWeight: '700',
                  fontSize: '15px',
                  cursor: 'pointer',
                  flex: 0.8
                }}
              >
                放弃
              </button>
            </>
          )}
        </div>

        {/* AI 拆解与子任务 - 移至底部 */}
        <div style={{
          marginTop: 'auto',
          paddingTop: '20px',
          borderTop: task.subtasks?.length > 0 ? `1px solid ${COLORS.glassBorder}` : 'none'
        }}>
          {!task.subtasks?.length && (
            <button
              onClick={handleBreakdown}
              disabled={isBreakingDown}
              style={{
                background: 'rgba(0, 242, 255, 0.05)',
                border: `1px solid ${COLORS.neonBlue}20`,
                borderRadius: '20px',
                padding: '8px 20px',
                fontSize: '12px',
                color: COLORS.neonBlue,
                fontWeight: '700',
                cursor: isBreakingDown ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                opacity: 0.8
              }}
            >
              {isBreakingDown ? '正在进行第一性原理分析...' : '🔬 第一性原理拆解'}
            </button>
          )}

          {task.subtasks?.length > 0 && (
            <div
              className="subtasks-container"
              style={{
                maxHeight: '100px',
                overflowY: 'auto',
                padding: '0 10px'
              }}
            >
              {task.subtasks.map((sub, i) => (
                <div
                  key={sub.id}
                  className="subtask-item-focus"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '6px 0',
                    opacity: sub.done ? 0.4 : 0.8,
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSubtask(task.id, sub.id);
                    }}
                    style={{
                      width: '4px', height: '4px', borderRadius: '50%',
                      background: sub.done ? '#10b981' : COLORS.neonBlue,
                      boxShadow: `0 0 6px ${sub.done ? '#10b981' : COLORS.neonBlue}`,
                      flexShrink: 0
                    }}
                  />
                  <span
                    onClick={() => onToggleSubtask(task.id, sub.id)}
                    style={{
                      fontSize: '12px',
                      color: '#94a3b8',
                      textAlign: 'left',
                      textDecoration: sub.done ? 'line-through' : 'none',
                      flex: 1
                    }}
                  >
                    {sub.text}
                  </span>

                  {/* 子任务操作按钮 (专注界面) */}
                  <div className="subtask-actions-focus" style={{
                    display: 'flex',
                    gap: '10px',
                    opacity: isMobile ? 0.6 : 0,
                    transition: 'opacity 0.2s ease'
                  }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditSubtask(sub);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#00f2ff',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSubtask(sub.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes breath-wide {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.02); }
        }
        @keyframes breath-core {
          0%, 100% { stroke-width: 4px; opacity: 0.8; }
          50% { stroke-width: 5px; opacity: 1; }
        }
        .breath-ring-wide {
          animation: breath-wide 4s ease-in-out infinite;
          transform-origin: center;
        }
        .breath-ring-core {
          animation: breath-core 4s ease-in-out infinite;
        }
        @keyframes text-glow {
          0%, 100% { text-shadow: 0 0 20px rgba(0, 242, 255, 0.4); }
          50% { text-shadow: 0 0 40px rgba(0, 242, 255, 0.8), 0 0 10px rgba(0, 242, 255, 0.4); }
        }
        .timer-text {
          animation: text-glow 4s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes surge-up {
          0%   { transform: rotate(var(--deg, 0deg)) translateY(-10px) scale(1); opacity: 0.9; }
          60%  { opacity: 0.7; }
          100% { transform: rotate(var(--deg, 0deg)) translateY(-60px) scale(0.3); opacity: 0; }
        }
        @keyframes spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .subtasks-container::-webkit-scrollbar {
          display: none;
        }
        .subtasks-container {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  
  .subtask-item-focus:hover .subtask-actions-focus {
    opacity: 1 !important;
  }
 `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 精力球组件（精力值系统）
// ═══════════════════════════════════════════════════════════════════

function EnergyOrb({ energyLevel, phase, tasks, isMobile = false }) {
  const status = getEnergyStatus(energyLevel);

  // 赛博朋克霓虹色彩覆盖
  const getCyberColors = (level) => {
    if (level >= 80) return { primary: '#00f2ff', secondary: '#0066ff', glow: 'rgba(0, 242, 255, 0.6)', label: '超能模式' };
    if (level >= 50) return { primary: '#3b82f6', secondary: '#2563eb', glow: 'rgba(59, 130, 246, 0.5)', label: '同步稳定' };
    if (level >= 20) return { primary: '#f59e0b', secondary: '#d97706', glow: 'rgba(245, 158, 11, 0.4)', label: '能效预警' };
    return { primary: '#ff0055', secondary: '#990033', glow: 'rgba(255, 0, 85, 0.6)', label: '系统崩溃' };
  };

  const colors = getCyberColors(energyLevel);
  const rippleIntensity = status.rippleIntensity;
  const pulse = 1 + Math.sin(phase * 0.05) * 0.03 * rippleIntensity;

  const size = isMobile ? 90 : 110; // 进一步减小尺寸以节省空间
  const innerSize = size * 0.82;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: isMobile ? '8px 0' : '12px 0', // 减小内边距
      position: 'relative',
      flexShrink: 0,
      width: '100%'
    }}>
      <div style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {/* 外层旋转环 - 双重环效果 */}
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: `1px dashed ${colors.primary}60`,
          transform: `rotate(${phase * 0.5}deg)`,
          opacity: 0.6
        }} />
        <div style={{
          position: 'absolute',
          width: '115%',
          height: '115%',
          borderRadius: '50%',
          border: `1px dotted ${colors.primary}20`,
          transform: `rotate(${-phase * 0.2}deg)`,
          opacity: 0.3
        }} />

        {/* 扫描线效果 */}
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '2px',
          background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
          top: `${50 + Math.sin(phase * 0.1) * 45}%`,
          opacity: 0.4,
          zIndex: 5,
          pointerEvents: 'none',
          boxShadow: `0 0 8px ${colors.primary}`
        }} />

        {/* 核心球体 */}
        <div style={{
          position: 'relative',
          width: `${innerSize}px`,
          height: `${innerSize}px`,
          borderRadius: '50%',
          background: '#05070a',
          border: `2px solid ${colors.primary}`,
          boxShadow: `
            0 0 25px ${colors.glow},
            inset 0 0 15px ${colors.primary}40
          `,
          transform: `scale(${pulse})`,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2
        }}>
          {/* 能量填充液面 - 酷炫波浪 */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${energyLevel}%`,
            background: `linear-gradient(to top, ${colors.secondary}cc, ${colors.primary}99)`,
            transition: 'height 1s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 1
          }}>
            {/* 动态波浪效果 */}
            <div style={{
              position: 'absolute',
              top: '-15px',
              left: '-50%',
              width: '200%',
              height: '40px',
              background: colors.primary,
              borderRadius: '42%',
              filter: 'blur(10px)',
              opacity: 0.7,
              transform: `translateX(${Math.sin(phase * 0.08) * 40}px) rotate(${phase * 2}deg)`
            }} />

          </div>

          {/* 文字内容 - 置于球体中心 */}
          <div style={{
            position: 'relative',
            zIndex: 10,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textShadow: '0 0 10px rgba(0,0,0,0.9)'
          }}>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: isMobile ? '20px' : '26px', // 稍减小字号以配合球体
              fontWeight: '900',
              color: '#fff',
              lineHeight: 1,
              marginBottom: '1px'
            }}>
              {Math.round(energyLevel)}<span style={{ fontSize: '10px', opacity: 0.8 }}>%</span>
            </div>
            <div style={{
              fontSize: '7px',
              fontWeight: '800',
              color: '#fff',
              opacity: 0.9,
              letterSpacing: '1px',
              textTransform: 'uppercase'
            }}>
              {colors.label}
            </div>
          </div>

          {/* 故障效果装饰 (仅在低能量或随机出现) */}
          {(energyLevel < 20 || Math.sin(phase * 0.5) > 0.98) && (
            <div style={{
              position: 'absolute',
              top: '20%', left: 0, width: '100%', height: '1px',
              background: '#ff0055', boxShadow: '0 0 5px #ff0055',
              zIndex: 15, opacity: 0.5,
              transform: `translateX(${Math.random() * 10 - 5}px)`,
              filter: 'hue-rotate(90deg)'
            }} />
          )}
          {(energyLevel < 20 || Math.sin(phase * 0.5 + 1) > 0.98) && (
            <div style={{
              position: 'absolute',
              bottom: '30%', right: 0, width: '80%', height: '1px',
              background: COLORS.neonBlue, boxShadow: `0 0 5px ${COLORS.neonBlue}`,
              zIndex: 15, opacity: 0.4,
              transform: `translateX(${Math.random() * 10 - 5}px)`,
            }} />
          )}

          {/* 内部噪点纹理 */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            opacity: 0.1, // 增加噪点可见度
            pointerEvents: 'none',
            zIndex: 2
          }} />
        </div>

        {/* 轨道粒子 - 增加数量和动效 */}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: i % 2 === 0 ? '2px' : '4px',
              height: i % 2 === 0 ? '2px' : '1px',
              background: colors.primary,
              borderRadius: '50%',
              boxShadow: `0 0 6px ${colors.primary}`,
              transform: `rotate(${phase * (0.5 + i * 0.2) + i * 60}deg) translateX(${size / 2 + 6}px)`,
              opacity: 0.6 + Math.sin(phase * 0.1 + i) * 0.3
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 精力详情面板
// ═══════════════════════════════════════════════════════════════════

function EnergyDetailModal({ energyLevel, tasks, onClose, isMobile = false }) {
  const status = getEnergyStatus(energyLevel);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.done).length;
  const pendingTasks = totalTasks - completedTasks;

  const tasksByCategory = {
    work: tasks.filter(t => t.category === 'work' && !t.done).length,
    study: tasks.filter(t => t.category === 'study' && !t.done).length,
    life: tasks.filter(t => t.category === 'life' && !t.done).length
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(5, 7, 10, 0.9)',
      backdropFilter: 'blur(20px)',
      display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center',
      justifyContent: 'center',
      zIndex: 5000,
      padding: isMobile ? 0 : '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(30px)',
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: isMobile ? '24px 24px 0 0' : '24px',
        padding: isMobile ? '32px 24px env(safe-area-inset-bottom)' : '40px',
        position: 'relative',
        boxShadow: `0 0 50px rgba(0, 0, 0, 0.5)`,
        maxHeight: isMobile ? '90vh' : 'auto',
        overflowY: 'auto'
      }}>
        <div style={{
          position: 'absolute',
          top: 0, left: '20%', right: '20%', height: '2px',
          background: `linear-gradient(90deg, transparent, ${status.color.primary}, transparent)`
        }} />

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px'
        }}>
          <h2 style={{
            fontSize: '16px',
            fontWeight: '800',
            color: COLORS.textMain,
            letterSpacing: '2px',
            textTransform: 'uppercase'
          }}>
            系统诊断
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${COLORS.glassBorder}`,
              color: COLORS.textSecondary,
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        <div style={{
          padding: '24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: `1px solid ${status.color.primary}30`,
          borderRadius: '20px',
          textAlign: 'center',
          marginBottom: '32px',
          boxShadow: `inset 0 0 20px ${status.color.primary}10`
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: isMobile ? '42px' : '56px',
            fontWeight: '800',
            color: status.color.primary,
            textShadow: `0 0 30px ${status.color.primary}40`,
            marginBottom: '8px'
          }}>
            {Math.round(energyLevel)}%
          </div>
          <div style={{
            fontSize: '12px',
            fontWeight: '700',
            color: COLORS.textMain,
            letterSpacing: '1px',
            textTransform: 'uppercase'
          }}>
            {status.label}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '32px'
        }}>
          {[
            { label: 'TOTAL', val: totalTasks, color: COLORS.neonBlue },
            { label: 'SYNCED', val: completedTasks, color: '#10b981' },
            { label: 'ACTIVE', val: pendingTasks, color: '#f59e0b' }
          ].map(stat => (
            <div key={stat.label} style={{
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: `1px solid ${COLORS.glassBorder}`,
              borderRadius: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '18px', fontWeight: '800', color: stat.color }}>{stat.val}</div>
              <div style={{ fontSize: '9px', fontWeight: '700', color: COLORS.textSecondary, marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '20px',
          background: `${status.color.primary}10`,
          borderLeft: `4px solid ${status.color.primary}`,
          borderRadius: '8px',
          fontSize: '13px',
          lineHeight: '1.6',
          color: COLORS.textMain
        }}>
          <div style={{ fontWeight: '800', fontSize: '11px', marginBottom: '8px', opacity: 0.7 }}>RECOMMENDATION_ENGINE</div>
          {status.advice}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: '32px',
            padding: '16px',
            background: `linear-gradient(135deg, ${status.color.primary}, ${status.color.secondary})`,
            border: 'none',
            borderRadius: '12px',
            color: '#fff',
            fontWeight: '800',
            fontSize: '13px',
            letterSpacing: '1px',
            cursor: 'pointer',
            boxShadow: `0 4px 20px ${status.color.primary}40`
          }}
        >
          CLOSE DIAGNOSTICS
        </button>
      </div>
    </div>
  );
}
