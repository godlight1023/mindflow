// pages/api/chat.js
// DeepSeek API 路由

export default async function handler(req, res) {
  // 1. 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. CORS 设置
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  try {
    const { system, message } = req.body;

    // 3. 输入验证
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: '消息格式不正确'
      });
    }

    if (message.length > 15000) {
      return res.status(400).json({ 
        error: 'Message too long',
        message: '消息太长，请精简后重试'
      });
    }

    // 4. 检查 API 密钥
    if (!process.env.DEEPSEEK_API_KEY) {
      console.error('DEEPSEEK_API_KEY not configured');
      return res.status(500).json({ 
        error: 'Configuration error',
        message: '❌ DeepSeek API 密钥未配置。请在环境变量中添加 DEEPSEEK_API_KEY'
      });
    }

    // 5. 构建消息
    const messages = [];
    
    // 如果有系统提示，添加为用户消息的前缀
    if (system) {
      messages.push({
        role: 'system',
        content: system
      });
    }
    
    messages.push({
      role: 'user',
      content: message
    });

    // 6. 调用 DeepSeek API
    const apiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',  // DeepSeek 的主要模型
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
      })
    });

    // 7. 处理 API 错误
    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}));
      console.error('DeepSeek API error:', {
        status: apiResponse.status,
        error: errorData
      });

      // 根据不同错误返回友好提示
      let errorMessage = '服务暂时不可用';
      if (apiResponse.status === 429) {
        errorMessage = '请求过于频繁，请稍后再试';
      } else if (apiResponse.status === 401) {
        errorMessage = 'API 密钥无效，请检查配置';
      } else if (apiResponse.status >= 500) {
        errorMessage = 'AI 服务暂时不可用，请稍后重试';
      }

      return res.status(apiResponse.status >= 500 ? 503 : apiResponse.status).json({ 
        error: 'AI service error',
        message: errorMessage
      });
    }

    // 8. 解析并返回响应
    const data = await apiResponse.json();
    const textContent = data.choices?.[0]?.message?.content || '{}';

    // 记录成功（仅在开发环境）
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ DeepSeek API call successful');
      console.log('📊 Token usage:', data.usage);
    }

    return res.status(200).json({ 
      response: textContent,
      usage: data.usage // 返回 token 使用情况
    });

  } catch (error) {
    // 9. 捕获所有其他错误
    console.error('Chat API error:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' 
        ? error.message 
        : '服务器错误，请稍后重试'
    });
  }
}