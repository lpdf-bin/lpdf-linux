import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const openMock = vi.fn();
const saveMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: openMock,
	save: saveMock,
}));

describe("PDF convert dialog flows", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		openMock.mockReset();
		saveMock.mockReset();
	});

	it("converts PDF to Excel through doc_convert_pdf_to_excel", async () => {
		const { convertPdfToExcelDialogFlow } = await import("./commands");
		openMock.mockResolvedValue("/tmp/source.pdf");
		saveMock.mockResolvedValue("/tmp/output.xlsx");
		invokeMock.mockResolvedValue({
			output_path: "/tmp/output.xlsx",
			engine: "soffice",
		});

		const result = await convertPdfToExcelDialogFlow();

		expect(saveMock).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: "converted.xlsx",
			}),
		);
		expect(invokeMock).toHaveBeenCalledWith("doc_convert_pdf_to_excel", {
			inputPath: "/tmp/source.pdf",
			outputPath: "/tmp/output.xlsx",
		});
		expect(result).toEqual({
			output_path: "/tmp/output.xlsx",
			engine: "soffice",
		});
	});

	it("converts PDF to PowerPoint through doc_convert_pdf_to_ppt", async () => {
		const { convertPdfToPptDialogFlow } = await import("./commands");
		openMock.mockResolvedValue("/tmp/source.pdf");
		saveMock.mockResolvedValue("/tmp/output.pptx");
		invokeMock.mockResolvedValue({
			output_path: "/tmp/output.pptx",
			engine: "pandoc-fallback",
		});

		const result = await convertPdfToPptDialogFlow();

		expect(saveMock).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: "converted.pptx",
			}),
		);
		expect(invokeMock).toHaveBeenCalledWith("doc_convert_pdf_to_ppt", {
			inputPath: "/tmp/source.pdf",
			outputPath: "/tmp/output.pptx",
		});
		expect(result).toEqual({
			output_path: "/tmp/output.pptx",
			engine: "pandoc-fallback",
		});
	});
});
