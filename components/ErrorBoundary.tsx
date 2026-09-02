import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in application:", error, errorInfo);
  }

  private handleRetry = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col justify-center items-center h-screen bg-gray-100 text-center p-6">
            <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full flex flex-col items-center">
                <AlertTriangle size={64} className="text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2 text-gray-800">حدث خطأ غير متوقع</h1>
                <p className="text-gray-600 mb-6 text-base">
                    نأسف، واجه التطبيق مشكلة تقنية. يرجى محاولة إعادة تحميل الصفحة.
                </p>
                <button
                    onClick={this.handleRetry}
                    className="flex items-center justify-center space-x-2 space-x-reverse bg-primary-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-primary-700 transition-colors w-full text-lg font-semibold"
                >
                    <RefreshCw size={20} />
                    <span>إعادة تحميل الصفحة</span>
                </button>
                {process.env.NODE_ENV === 'development' && this.state.error && (
                    <details className="mt-4 text-left w-full bg-gray-50 p-2 rounded text-xs text-red-600 overflow-auto max-h-32">
                        <summary>تفاصيل الخطأ</summary>
                        <pre>{this.state.error.toString()}</pre>
                    </details>
                )}
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;