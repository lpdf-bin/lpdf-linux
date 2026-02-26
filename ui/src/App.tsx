import { useEffect } from "react";
import { useEditorStore } from "./state/editorStore";
import { TopToolbar } from "./components/workspace/TopToolbar";
import { ContextualSubBar } from "./components/workspace/ContextualSubBar";
import { PageSidebar } from "./components/workspace/PageSidebar";
import { EditorCanvas } from "./components/workspace/EditorCanvas";
import { InspectorPanel } from "./components/workspace/InspectorPanel";
import { FileOpenPanel } from "./components/home/FileOpenPanel";
import { SettingsModal } from "./components/common/SettingsModal";
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import "./styles/tokens.css";
import "./styles/app.css";

export default function App() {
	const {
		isDocLoaded,
		theme,
		showWhiteoutWarning,
		dismissWhiteoutWarning,
		toasts,
		dismissToast,
	} = useEditorStore();

	useEffect(() => {
		document.body.className =
			theme === "light" ? "theme-light" : "theme-dark";
	}, [theme]);

	return (
		<div className="lpdf-shell">
			<TopToolbar />
			<ContextualSubBar />
			<div className="workspace">
				{isDocLoaded ? (
					<>
						<PageSidebar />
						<EditorCanvas />
						<InspectorPanel />
					</>
				) : (
					<FileOpenPanel />
				)}
			</div>

			{/* Toast System */}
			{toasts.length > 0 ? (
				<div className="toast-stack">
					{toasts.map((toast) => (
						<div
							key={toast.id}
							className={`toast-notification ${toast.kind}-toast`}
						>
							<div className="toast-icon">
								{toast.kind === "success" ? (
									<CheckCircle2 size={18} />
								) : toast.kind === "info" ? (
									<Info size={18} />
								) : toast.kind === "warning" ? (
									<TriangleAlert size={18} />
								) : (
									<CircleAlert size={18} />
								)}
							</div>
							<div className="toast-content">
								<strong>{toast.title}</strong>
								<p>{toast.message}</p>
							</div>
							<button
								className="toast-close"
								onClick={() => dismissToast(toast.id)}
							>
								<X size={16} />
							</button>
						</div>
					))}
				</div>
			) : null}

			{isDocLoaded && showWhiteoutWarning && (
				<div className="toast-notification warning-toast whiteout-warning-toast">
					<div className="toast-icon">
						<TriangleAlert size={18} />
					</div>
					<div className="toast-content">
						<strong>Security Warning</strong>
						<p>
							Whiteout visually obscures text but does not remove
							it from the underlying file metadata. Do not use for
							secure redaction.
						</p>
					</div>
					<button
						className="toast-close"
						onClick={dismissWhiteoutWarning}
					>
						<X size={16} />
					</button>
				</div>
			)}

			<SettingsModal />
		</div>
	);
}
