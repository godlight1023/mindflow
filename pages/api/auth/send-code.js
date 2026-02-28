// pages/api/auth/send-code.js
import nodemailer from 'nodemailer';
import { getSupabase } from '../../../lib/supabase';

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 清理过期数据
async function cleanupExpiredData(supabase) {
  try {
    const now = new Date().toISOString();
    
    // 删除过期验证码
    await supabase
      .from('verification_codes')
      .delete()
      .lt('expires_at', now);
    
    // 删除过期验证标记
    await supabase
      .from('verified_emails')
      .delete()
      .lt('expires_at', now);
    
    // 删除旧的频率限制记录（超过1小时）
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await supabase
      .from('rate_limits')
      .delete()
      .lt('last_sent_at', oneHourAgo);
  } catch (error) {
    console.error('清理过期数据失败:', error);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    const supabase = getSupabase();

    // 异步清理过期数据（不阻塞主流程）
    cleanupExpiredData(supabase).catch(console.error);

    // 检查发送频率（60秒限制）
    const { data: rateLimit } = await supabase
      .from('rate_limits')
      .select('last_sent_at')
      .eq('email', email)
      .single();

    if (rateLimit) {
      const lastSent = new Date(rateLimit.last_sent_at).getTime();
      const timeSince = Date.now() - lastSent;
      
      if (timeSince < 60000) {
        const waitSeconds = Math.ceil((60000 - timeSince) / 1000);
        return res.status(429).json({ 
          error: `请 ${waitSeconds} 秒后再试` 
        });
      }
    }

    // 生成验证码
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10分钟

    // 保存验证码到 Supabase（upsert：如果存在则更新）
    const { error: codeError } = await supabase
      .from('verification_codes')
      .upsert({
        email,
        code,
        expires_at: expiresAt,
        attempts: 0,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'email'
      });

    if (codeError) {
      console.error('保存验证码失败:', codeError);
      return res.status(500).json({ error: '保存验证码失败' });
    }

    // 更新发送频率限制
    await supabase
      .from('rate_limits')
      .upsert({
        email,
        last_sent_at: new Date().toISOString()
      }, {
        onConflict: 'email'
      });

    console.log(`✅ 验证码已保存到 Supabase: ${email} -> ${code}`);

    // 配置邮件
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: process.env.EMAIL_SERVER_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
    });

    // 发送邮件
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'MindFlow 登录验证码',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 10px; text-align: center;">
            <h1 style="color: white; font-size: 48px; margin: 0 0 20px 0;">✦</h1>
            <h2 style="color: white; margin: 0 0 30px 0;">MindFlow 登录验证码</h2>
            <div style="background: white; padding: 30px; border-radius: 10px; margin: 20px 0;">
              <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: monospace;">
                ${code}
              </div>
            </div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 20px 0 0 0;">
              验证码有效期为 <strong>10 分钟</strong>
            </p>
            <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 10px 0 0 0;">
              如果这不是您的操作，请忽略此邮件
            </p>
          </div>
        </div>
      `,
      text: `您的 MindFlow 登录验证码是：${code}\n\n验证码有效期为 10 分钟。`
    });

    console.log(`📧 验证码邮件已发送到 ${email}`);

    return res.status(200).json({ 
      success: true,
      message: '验证码已发送'
    });

  } catch (error) {
    console.error('发送验证码失败:', error);
    return res.status(500).json({ 
      error: '发送验证码失败，请稍后重试' 
    });
  }
}