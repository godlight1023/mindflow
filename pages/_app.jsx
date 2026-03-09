// pages/_app.jsx
import { SessionProvider } from 'next-auth/react';
import Head from 'next/head';

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {
  return (
    <SessionProvider session={session}>
      <Head>
        <link rel="icon" href="/mindflow.png" type="image/png" />
        <link rel="apple-touch-icon" href="/mindflow.png" />
        <link rel="manifest" href="/manifest.json" />
      </Head>
      <Component {...pageProps} />
    </SessionProvider>
  );
}