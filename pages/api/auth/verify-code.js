// pages/api/auth/verify-code.js
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, code } = req.body;

    console.log(`🔍 验证请求: ${email} - 验证码: ${code}`);

    if (!email || !code) {
      return res.status(400).json({ error: '请输入邮箱和验证码' });
    }

    const supabase = getSupabase();

    // 从 Supabase 获取验证码
    const { data: codeData, error: fetchError } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !codeData) {
      console.log(`❌ 验证码不存在: ${email}`);
      return res.status(400).json({ error: '验证码不存在或已过期' });
    }

    // 检查过期
    const now = new Date();
    const expiresAt = new Date(codeData.expires_at);
    
    if (now > expiresAt) {
      // 删除过期验证码
      await supabase
        .from('verification_codes')
        .delete()
        .eq('email', email);
      
      console.log(`❌ 验证码已过期: ${email}`);
      return res.status(400).json({ error: '验证码已过期' });
    }

    // 检查尝试次数
    if (codeData.attempts >= 5) {
      // 删除验证码
      await supabase
        .from('verification_codes')
        .delete()
        .eq('email', email);
      
      console.log(`❌ 尝试次数过多: ${email}`);
      return res.status(400).json({ error: '验证码错误次数过多，请重新获取' });
    }

    // 验证验证码
    if (codeData.code !== code) {
      // 增加尝试次数
      await supabase
        .from('verification_codes')
        .update({ attempts: codeData.attempts + 1 })
        .eq('email', email);
      
      console.log(`❌ 验证码错误: ${email} (尝试 ${codeData.attempts + 1}/5)`);
      return res.status(400).json({ error: '验证码错误' });
    }

    // 验证成功，删除验证码
    await supabase
      .from('verification_codes')
      .delete()
      .eq('email', email);

    console.log(`✅ 验证成功: ${email}`);

    // 标记邮箱为已验证（5分钟有效）
    const verifiedExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    await supabase
      .from('verified_emails')
      .upsert({
        email,
        verified_at: new Date().toISOString(),
        expires_at: verifiedExpiresAt
      }, {
        onConflict: 'email'
      });

    console.log(`✅ 邮箱已标记为验证: ${email}`);

    return res.status(200).json({ 
      success: true,
      email
    });

  } catch (error) {
    console.error('验证失败:', error);
    return res.status(500).json({ error: '验证失败，请稍后重试' });
  }
}