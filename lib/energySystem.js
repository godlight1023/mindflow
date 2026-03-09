// lib/energySystem.js
// 精力值系统 - 模拟真实的精力状态

const ENERGY_CONFIG = {
  // 能量配置
  MAX_ENERGY: 100,
  MIN_ENERGY: 0,
  INITIAL_ENERGY: 100,

  // 消耗配置
  FOCUS_DRAIN_RATE: 0.2, // 专注模式每分钟消耗 0.2%
  PASSIVE_DECAY_RATE: 1, // 每小时被动衰减 1%

  // 分类权重（任务完成消耗倍率）
  CATEGORY_WEIGHT: {
    work: 1.2,   // 工作类消耗更多
    study: 1.0,  // 学习类正常
    life: 0.7,   // 生活类较少
  },

  // 恢复配置
  TASK_RECOVERY_BASE: 15, // 完成任务基础恢复 15%
  SUBTASK_STREAK_REWARD: 5, // 连续三个子任务奖励精力
  OFFLINE_RECOVERY_HOURS: 4, // 离线多少小时触发全量恢复

  // 颜色阈值
  THRESHOLDS: {
    EXCELLENT: 80,  // 80-100%
    GOOD: 50,       // 50-80%
    WARNING: 20,    // 20-50%
    CRITICAL: 0     // 0-20%
  }
};

// 获取能量状态配置
export function getEnergyStatus(energyLevel) {
  if (energyLevel >= ENERGY_CONFIG.THRESHOLDS.EXCELLENT) {
    return {
      color: { primary: '#10b981', secondary: '#059669', glow: '#34d399' },
      rippleSpeed: 0.03,
      rippleIntensity: 0.3,
      label: '精力充沛',
      emoji: '💚',
      advice: '适合处理高难度工作任务',
      recommendation: 'work'
    };
  } else if (energyLevel >= ENERGY_CONFIG.THRESHOLDS.GOOD) {
    return {
      color: { primary: '#3b82f6', secondary: '#2563eb', glow: '#60a5fa' },
      rippleSpeed: 0.05,
      rippleIntensity: 0.5,
      label: '状态良好',
      emoji: '💙',
      advice: '适合推进学习类任务',
      recommendation: 'study'
    };
  } else if (energyLevel >= ENERGY_CONFIG.THRESHOLDS.WARNING) {
    return {
      color: { primary: '#f59e0b', secondary: '#d97706', glow: '#fbbf24' },
      rippleSpeed: 0.08,
      rippleIntensity: 0.7,
      label: '开始疲劳',
      emoji: '⚠️',
      advice: '建议处理轻松的生活任务',
      recommendation: 'life'
    };
  } else {
    return {
      color: { primary: '#ef4444', secondary: '#dc2626', glow: '#fca5a5' },
      rippleSpeed: 0.12,
      rippleIntensity: 0.9,
      label: '严重透支',
      emoji: '🔴',
      advice: '请休息或完成现有任务',
      recommendation: 'rest'
    };
  }
}

// 计算任务完成后的能量恢复
export function calculateRecovery(taskDuration) {
  const recovery = (taskDuration / 60) * ENERGY_CONFIG.TASK_RECOVERY_BASE;
  return Math.min(recovery, 25); // 单次最多恢复 25%
}

// 计算被动衰减
export function calculatePassiveDecay(lastUpdateTime) {
  const now = Date.now();
  const hoursPassed = (now - lastUpdateTime) / (1000 * 60 * 60);
  const decay = hoursPassed * ENERGY_CONFIG.PASSIVE_DECAY_RATE;
  return Math.min(decay, 20); // 最多衰减 20%
}

// 计算专注模式消耗
export function calculateFocusDrain(minutes) {
  return minutes * ENERGY_CONFIG.FOCUS_DRAIN_RATE;
}

// 检查是否需要每日重置
export function shouldResetEnergy(lastResetDate) {
  const today = new Date().toISOString().slice(0, 10);
  return lastResetDate !== today;
}

// ── 异步任务完成扣除 ─────────────────────────────────────────────
// 根据 estimated_duration 和 category 权重一次性扣除精力
// 返回 { newLevel, drained, isOvertime, message }
export function calcTaskCompletionDrain(task, completedAt = Date.now()) {
  const duration = task.duration || 30; // 预估时长（分钟）
  const category = task.category || 'work';
  const weight = ENERGY_CONFIG.CATEGORY_WEIGHT[category] ?? 1.0;

  // 基础扣除 = duration * 0.2% * 权重（专注模式满速率）
  let baseDrain = duration * ENERGY_CONFIG.FOCUS_DRAIN_RATE * weight;

  // 时间溢出检测：如果任务开始时间已知，比较实际耗时
  let isOvertime = false;
  if (task.startTime && task.date) {
    const [h, m] = task.startTime.split(':').map(Number);
    const taskStartMs = new Date(`${task.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
    const actualMinutes = (completedAt - taskStartMs) / 60000;
    if (actualMinutes > duration * 1.5) {
      // 超时超过50%，按预估时长的1.2倍扣除
      baseDrain = duration * 1.2 * ENERGY_CONFIG.FOCUS_DRAIN_RATE * weight;
      isOvertime = true;
    }
  }

  const drained = Math.min(baseDrain, 30); // 单次最多扣30%
  return {
    drained,
    isOvertime,
    message: isOvertime ? '长时间专注，辛苦了 💪' : null,
  };
}

// ── 连续子任务奖励 ───────────────────────────────────────────────
// 连续勾选 3 个子任务触发精力小幅回升
export function calcSubtaskStreakReward() {
  return ENERGY_CONFIG.SUBTASK_STREAK_REWARD;
}

// ── 离线补偿 ─────────────────────────────────────────────────────
// 若距上次活跃超过 4 小时，精力恢复至 100%
export function checkOfflineRecovery(energyData) {
  if (!energyData) return null;
  const now = Date.now();
  const lastActive = energyData.lastActiveTime || energyData.lastUpdateTime || 0;
  const hoursGone = (now - lastActive) / (1000 * 60 * 60);
  if (hoursGone >= ENERGY_CONFIG.OFFLINE_RECOVERY_HOURS) {
    return {
      shouldRecover: true,
      hoursGone: hoursGone.toFixed(1),
      newLevel: ENERGY_CONFIG.MAX_ENERGY,
    };
  }
  return { shouldRecover: false };
}

// 获取能量数据
export function getEnergyData(userId) {
  if (!userId) return null;
  try {
    const key = `mindflow_energy_${userId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// 保存能量数据
export function saveEnergyData(userId, energyData) {
  if (!userId) return;
  try {
    const key = `mindflow_energy_${userId}`;
    localStorage.setItem(key, JSON.stringify(energyData));
  } catch (e) {
    console.error('Save energy failed:', e);
  }
}

// 初始化或获取能量状态
export function initializeEnergy(userId) {
  let energyData = getEnergyData(userId);
  const today = new Date().toISOString().slice(0, 10);

  if (!energyData || shouldResetEnergy(energyData.lastResetDate)) {
    energyData = {
      level: ENERGY_CONFIG.INITIAL_ENERGY,
      lastUpdateTime: Date.now(),
      lastActiveTime: Date.now(),
      lastResetDate: today
    };
    saveEnergyData(userId, energyData);
    console.log('🌅 新的一天，精力已重置为 100%');
  } else {
    // 应用被动衰减
    const decay = calculatePassiveDecay(energyData.lastUpdateTime);
    if (decay > 0) {
      energyData.level = Math.max(ENERGY_CONFIG.MIN_ENERGY, energyData.level - decay);
      energyData.lastUpdateTime = Date.now();
      saveEnergyData(userId, energyData);
      console.log(`⏰ 被动衰减 ${decay.toFixed(1)}%，当前精力 ${energyData.level.toFixed(1)}%`);
    }
  }

  return energyData;
}

// 消耗能量
export function drainEnergy(userId, amount, reason = 'unknown') {
  const energyData = getEnergyData(userId);
  if (!energyData) return;

  energyData.level = Math.max(ENERGY_CONFIG.MIN_ENERGY, energyData.level - amount);
  energyData.lastUpdateTime = Date.now();
  energyData.lastActiveTime = Date.now();
  saveEnergyData(userId, energyData);

  console.log(`⚡ 消耗精力 ${amount.toFixed(1)}% (${reason})，剩余 ${energyData.level.toFixed(1)}%`);
  return energyData.level;
}

// 恢复能量
export function recoverEnergy(userId, amount, reason = 'unknown') {
  const energyData = getEnergyData(userId);
  if (!energyData) return;

  const oldLevel = energyData.level;
  energyData.level = Math.min(ENERGY_CONFIG.MAX_ENERGY, energyData.level + amount);
  energyData.lastUpdateTime = Date.now();
  energyData.lastActiveTime = Date.now();
  saveEnergyData(userId, energyData);

  const actualRecovery = energyData.level - oldLevel;
  console.log(`💚 恢复精力 ${actualRecovery.toFixed(1)}% (${reason})，当前 ${energyData.level.toFixed(1)}%`);
  return energyData.level;
}