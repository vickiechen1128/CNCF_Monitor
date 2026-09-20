/**
 * 触发浏览器下载 Blob（Excel 模板等二进制流，§6.1/T07-08；响应非 JSON 信封）。
 * 供 TemplateDownloadModal 与 ImportModal 复用。
 */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
