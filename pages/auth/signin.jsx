// pages/auth/signin.jsx
import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

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
      // 验证验证码
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

      // 使用 NextAuth 登录
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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #040810 0%, #0d1426 100%)',
      padding: '20px',
      fontFamily: '-apple-system, sans-serif'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(13,20,38,0.8)',
        backdropFilter: 'blur(30px)',
        borderRadius: '24px',
        padding: '48px 40px',
        border: '1px solid rgba(99,179,237,0.15)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)'
      }}>
        {/* Logo */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: '32px'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            boxShadow: '0 8px 32px rgba(37,99,235,0.4)'
          }}>
            ✦
          </div>
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
          marginBottom: '32px'
        }}>
          {step === 1 ? '输入邮箱获取验证码' : '输入收到的 6 位验证码'}
        </p>

        {step === 1 ? (
          <form onSubmit={handleSendCode}>
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="your@email.com"
                required
                disabled={loading}
                autoFocus
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: '15px',
                  color: '#f1f5f9',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: '12px',
                  outline: 'none'
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
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
                padding: '14px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                background: loading || !email
                  ? 'rgba(99,179,237,0.3)'
                  : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '12px',
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                boxShadow: loading || !email ? 'none' : '0 4px 16px rgba(37,99,235,0.4)'
              }}
            >
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <div style={{
              padding: '12px 16px',
              background: 'rgba(99,179,237,0.08)',
              border: '1px solid rgba(99,179,237,0.15)',
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
                  padding: '14px 16px',
                  fontSize: '24px',
                  fontWeight: '600',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  color: '#f1f5f9',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(99,179,237,0.2)',
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
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
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
                padding: '14px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#fff',
                background: loading || code.length !== 6
                  ? 'rgba(99,179,237,0.3)'
                  : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                border: 'none',
                borderRadius: '12px',
                cursor: loading || code.length !== 6 ? 'not-allowed' : 'pointer',
                boxShadow: loading || code.length !== 6 ? 'none' : '0 4px 16px rgba(37,99,235,0.4)',
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
    </div>
  );
}