export default function Home() {
  return (
    <main className="grain flex min-h-screen flex-col items-center justify-center bg-cream text-ink">
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-forest/25" />
        <span className="absolute inset-[18%] rounded-full border border-forest/45" />
        <span className="absolute inset-[36%] rounded-full border border-forest/70" />
        <span className="h-2 w-2 rounded-full bg-forest" />
      </div>
      <h1 className="mt-6 font-serif text-4xl">Tour Activation</h1>
      <p className="mt-2 text-xs uppercase tracking-[0.3em] text-clay">
        Be there to unlock it
      </p>
    </main>
  );
}
