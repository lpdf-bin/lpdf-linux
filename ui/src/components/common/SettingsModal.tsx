import React from "react";
import { useEditorStore } from "../../state/editorStore";
import { X } from "lucide-react";

export const SettingsModal: React.FC = () => {
	const { isSettingsOpen, closeSettings } = useEditorStore();

	if (!isSettingsOpen) return null;

	return (
		<div className="modal-overlay" onClick={closeSettings}>
			<div className="modal-content" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Settings</h2>
					<button className="icon-btn" onClick={closeSettings}>
						<X size={18} />
					</button>
				</div>
				<div className="modal-body">
					<div className="setting-row">
						<div>
							<h3>Hardware Acceleration</h3>
							<p className="setting-desc">
								Use GPU for canvas rendering (requires restart)
							</p>
						</div>
						<input type="checkbox" defaultChecked />
					</div>
					<div className="setting-row">
						<div>
							<h3>Telemetry</h3>
							<p className="setting-desc">
								Send anonymous crash reports
							</p>
						</div>
						<input type="checkbox" disabled />
					</div>
					<div className="setting-row">
						<div>
							<h3>Default View</h3>
							<p className="setting-desc">
								Initial zoom level on open
							</p>
						</div>
						<select defaultValue="fit" className="setting-select themed-select">
							<option value="fit">Fit Width</option>
							<option value="100">100%</option>
							<option value="last">Remember Last</option>
						</select>
					</div>
				</div>
			</div>
		</div>
	);
};
