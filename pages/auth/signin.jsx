// pages/auth/signin.jsx
import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';

const COLORS = {
  bg: '#05070a',
  neonBlue: '#00f2ff',
  accent: '#3b82f6',
  textMain: '#f8fafc',
  textSecondary: '#94a3b8',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  error: '#ff0055'
};

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [starStyles, setStarStyles] = useState({ small: '', medium: '', large: '' });

  useEffect(() => {
    // 客户端生成随机星星样式，避免 styled-jsx 编译期 panic
    const generateStars = (count, size, colorBase) => {
      return Array.from({ length: count }).map(() => {
        const x = Math.floor(Math.random() * 3000);
        const y = Math.floor(Math.random() * 3000);
        const color = Math.random() > 0.8 ? COLORS.neonBlue : colorBase;
        return `${x}px ${y}px ${color}`;
      }).join(', ');
    };

    setStarStyles({
      small: generateStars(400, 1, '#fff'),
      medium: generateStars(150, 2, 'rgba(255,255,255,0.8)'),
      large: generateStars(80, 3, 'rgba(255,255,255,0.6)')
    });
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || '发送失败');
        setLoading(false);
        return;
      }
      setStep(2);
      setCountdown(60);
      setLoading(false);
    } catch (error) {
      setError('发送验证码失败，请重试');
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!code || code.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const verifyResponse = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const verifyData = await verifyResponse.json();
      if (!verifyResponse.ok) {
        setError(verifyData.error || '验证失败');
        setLoading(false);
        return;
      }
      const result = await signIn('credentials', {
        email,
        redirect: false
      });
      if (result?.error) {
        setError('登录失败，请重试');
        setLoading(false);
      } else {
        router.push('/');
      }
    } catch (error) {
      setError('验证失败，请重试');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: COLORS.bg,
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      {/* 动态星空背景 */}
      <div className="stars-container" style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 0,
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 50%, #0a1120 0%, #05070a 100%)',
        perspective: '1000px'
      }}>
        {/* 星空背景层 - 增加旋转漂移感 */}
        <div className="stars-wrapper" style={{
          position: 'absolute',
          width: '200%', height: '200%',
          top: '-50%', left: '-50%',
          animation: 'spaceRotate 120s linear infinite'
        }}>
          {/* 小星星层 */}
          <div className="stars-small" />
          {/* 中星星层 */}
          <div className="stars-medium" />
          {/* 大星星层 */}
          <div className="stars-large" />
        </div>
        
        {/* 流星 - 增加数量 */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`shooting-star shooting-star-${i + 1}`} />
        ))}
      </div>

      {/* 赛博光晕 - 增强亮度 */}
      <div style={{
        position: 'absolute',
        top: '10%', left: '5%',
        width: '600px', height: '600px',
        background: `radial-gradient(circle, ${COLORS.neonBlue}15, transparent 70%)`,
        filter: 'blur(80px)',
        zIndex: 0,
        animation: 'nebulaFloat 30s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '5%', right: '0%',
        width: '700px', height: '700px',
        background: `radial-gradient(circle, ${COLORS.accent}10, transparent 70%)`,
        filter: 'blur(100px)',
        zIndex: 0,
        animation: 'nebulaFloat 40s ease-in-out infinite reverse'
      }} />

      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(15, 23, 42, 0.4)',
        backdropFilter: 'blur(30px)',
        borderRadius: '32px',
        padding: '56px 40px',
        border: `1px solid ${COLORS.glassBorder}`,
        boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px ${COLORS.neonBlue}05`,
        position: 'relative',
        zIndex: 1,
        animation: 'fadeIn 0.8s ease-out'
      }}>
        {/* 顶部装饰条 */}
        <div style={{
          position: 'absolute',
          top: 0, left: '20%', right: '20%',
          height: '2px',
          background: `linear-gradient(90deg, transparent, ${COLORS.neonBlue}, transparent)`,
          opacity: 0.6
        }} />

        {/* Logo 区域 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '40px'
        }}>
          <div style={{
            position: 'relative',
            width: '72px',
            height: '72px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px'
          }}>
            <div style={{
              position: 'absolute',
              width: '100%', height: '100%',
              borderRadius: '20px',
              border: `2px solid ${COLORS.neonBlue}30`,
              transform: 'rotate(45deg)',
              animation: 'pulseBorder 4s ease-in-out infinite'
            }} />
            <div style={{ 
              fontSize: '36px', 
              color: '#fff',
              filter: `drop-shadow(0 0 12px ${COLORS.neonBlue}60)`,
              animation: 'logoFloat 3s ease-in-out infinite'
            }}>✦</div>
          </div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: '700',
            color: '#f1f5f9',
            textAlign: 'center',
            marginBottom: '8px'
          }}>
            欢迎使用 MindFlow
          </h1>
          <p style={{
            fontSize: '14px',
            color: 'rgba(148,163,184,0.8)',
            textAlign: 'center',
            margin: 0
          }}>
            {step === 1 ? '输入邮箱获取验证码' : '输入收到的 6 位验证码'}
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleSendCode} style={{ animation: 'slideLeft 0.5s ease-out' }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#e2e8f0',
                marginBottom: '8px'
              }}>
                邮箱地址
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="your@email.com"
                required
                disabled={loading}
                autoFocus
                style={{
                  width: '100%',
                  boxSizing: 'border-box', // 关键：确保宽度一致
                  padding: '14px 16px',
                  fontSize: '15px',
                  color: '#f1f5f9',
                  background: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(99, 179, 237, 0.2)',
                  borderRadius: '12px',
                  outline: 'none',
                  transition: 'all 0.3s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = COLORS.neonBlue;
                  e.target.style.boxShadow = `0 0 15px ${COLORS.neonBlue}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(99, 179, 237, 0.2)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#fca5a5'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              style={{
                width: '100%',
                boxSizing: 'border-box', // 关键：确保宽度一致
                padding: '14px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                background: loading || !email
                  ? 'rgba(99, 179, 237, 0.3)'
                  : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '12px',
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                boxShadow: loading || !email ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                if (!loading && email) {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 6px 20px rgba(37, 99, 235, 0.6)';
                }
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = loading || !email ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)';
              }}
            >
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} style={{ animation: 'slideRight 0.5s ease-out' }}>
            <div style={{
              padding: '12px 16px',
              background: 'rgba(99, 179, 237, 0.08)',
              border: '1px solid rgba(99, 179, 237, 0.15)',
              borderRadius: '10px',
              marginBottom: '24px',
              fontSize: '13px',
              color: '#93c5fd',
              textAlign: 'center'
            }}>
              验证码已发送到<br />
              <strong style={{ fontSize: '14px' }}>{email}</strong>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#e2e8f0',
                marginBottom: '8px'
              }}>
                验证码
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(value);
                  setError('');
                }}
                placeholder="请输入 6 位验证码"
                required
                disabled={loading}
                autoFocus
                maxLength={6}
                style={{
                  width: '100%',
                  boxSizing: 'border-box', // 关键：确保宽度一致
                  padding: '14px 16px',
                  fontSize: '24px',
                  fontWeight: '600',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  color: '#f1f5f9',
                  background: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(99, 179, 237, 0.2)',
                  borderRadius: '12px',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#fca5a5'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              style={{
                width: '100%',
                boxSizing: 'border-box', // 关键：确保宽度一致
                padding: '14px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                background: loading || code.length !== 6
                  ? 'rgba(99, 179, 237, 0.3)'
                  : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '12px',
                cursor: loading || code.length !== 6 ? 'not-allowed' : 'pointer',
                boxShadow: loading || code.length !== 6 ? 'none' : '0 4px 16px rgba(37, 99, 235, 0.4)',
                marginBottom: '12px'
              }}
            >
              {loading ? '验证中...' : '登录'}
            </button>

            <div style={{ textAlign: 'center' }}>
              {countdown > 0 ? (
                <p style={{
                  fontSize: '13px',
                  color: '#64748b',
                  margin: 0
                }}>
                  {countdown} 秒后可重新发送
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setCode('');
                    setError('');
                  }}
                  style={{
                    fontSize: '13px',
                    color: '#93c5fd',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  没收到？重新发送验证码
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      <style jsx>{`
        .stars-small {
          width: 1px;
          height: 1px;
          background: transparent;
          box-shadow: ${starStyles.small || '0 0 transparent'};
          animation: starTwinkle 4s ease-in-out infinite;
        }
        .stars-medium {
          width: 2px;
          height: 2px;
          background: transparent;
          box-shadow: ${starStyles.medium || '0 0 transparent'};
          animation: starTwinkle 6s ease-in-out infinite 1s;
        }
        .stars-large {
          width: 3px;
          height: 3px;
          background: transparent;
          box-shadow: ${starStyles.large || '0 0 transparent'};
          animation: starTwinkle 8s ease-in-out infinite 2s;
        }

        .shooting-star {
          position: absolute;
          left: 50%;
          top: 50%;
          height: 2px;
          width: 150px;
          background: linear-gradient(-45deg, #00f2ff, rgba(0, 0, 255, 0));
          border-radius: 999px;
          filter: drop-shadow(0 0 8px #00f2ff);
          animation: shooting 8s ease-in-out infinite;
          opacity: 0;
        }
        .shooting-star-1 { top: 10%; left: 10%; animation-delay: 0s; }
        .shooting-star-2 { top: 30%; left: 80%; animation-delay: 2s; }
        .shooting-star-3 { top: 70%; left: 30%; animation-delay: 4s; }
        .shooting-star-4 { top: 50%; left: 10%; animation-delay: 6s; }
        .shooting-star-5 { top: 20%; left: 50%; animation-delay: 1s; }

        @keyframes starTwinkle {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
        @keyframes spaceRotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes shooting {
          0% { transform: rotate(215deg) translateX(0); opacity: 1; }
          8% { transform: rotate(215deg) translateX(-600px); opacity: 0; }
          100% { transform: rotate(215deg) translateX(-600px); opacity: 0; }
        }
        @keyframes nebulaFloat {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.6; }
          50% { transform: translate(40px, -40px) scale(1.2); opacity: 0.9; }
        }
        @keyframes logoFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes pulseBorder {
          0%, 100% { transform: rotate(45deg) scale(1); opacity: 0.2; }
          50% { transform: rotate(45deg) scale(1.1); opacity: 0.5; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideLeft {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
