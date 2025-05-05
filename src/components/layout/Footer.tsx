export default function Footer() {
    const currentYear = new Date().getFullYear(); // Obtiene el año actual

    return (
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 py-4 px-4 sm:px-6 lg:px-8 mt-auto">
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          © {currentYear} Data center Clientes Externos
        </p>
      </footer>
    );
  }