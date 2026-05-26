export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shoppalyzer-logo.svg" alt="Shoppalyzer" className="h-9" />
        </div>
        {children}
      </div>
    </div>
  );
}
