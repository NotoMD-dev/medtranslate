let uploadedFile: File | null = null;

export function setUploadedFile(file: File | null) {
  uploadedFile = file;
}

export function getUploadedFile() {
  return uploadedFile;
}

export function clearUploadedFile() {
  uploadedFile = null;
}
