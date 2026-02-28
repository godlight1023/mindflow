// pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getSupabase } from '../../../lib/supabase';

async function isEmailVerified(email) {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('verified_emails')
      .select('expires_at')
      .eq('email', email)
      .single();

    if (error || !data) {
      console.log(`🔍 邮箱未验证: ${email}`);
      return false;
    }

    // 检查是否过期
    const now = new Date();
    const expiresAt = new Date(data.expires_at);

    if (now > expiresAt) {
      // 删除过期记录
      await supabase
        .from('verified_emails')
        .delete()
        .eq('email', email);
      
      console.log(`❌ 验证已过期: ${email}`);
      return false;
    }

    console.log(`✅ 邮箱验证有效: ${email}`);
    return true;
  } catch (error) {
    console.error('检查验证状态失败:', error);
    return false;
  }
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: "Email", type: "email" }
      },
      async authorize(credentials) {
        const email = credentials?.email;

        console.log('🔐 登录尝试:', email);

        if (!email) {
          throw new Error('请提供邮箱地址');
        }

        // 检查邮箱是否已验证
        const verified = await isEmailVerified(email);
        if (!verified) {
          throw new Error('请先验证邮箱');
        }

        console.log('✅ 登录成功:', email);

        // 返回用户对象
        return {
          id: email,
          email: email,
          name: email.split('@')[0]
        };
      }
    })
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
  },

  pages: {
    signIn: '/auth/signin',
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.email = token.email;
      }
      return session;
    },
  },

  debug: process.env.NODE_ENV === 'development',
};

export default NextAuth(authOptions);