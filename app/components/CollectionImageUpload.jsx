import { DropZone, Thumbnail, Spinner, Banner } from '@shopify/polaris';
import { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';

export default function CollectionImageUpload({ onImageUpload, initialImageUrl = "", onProcessingChange }) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [error, setError] = useState(null);
  const [uploadStep, setUploadStep] = useState('idle'); // 'idle' | 'staging' | 'uploading' | 'creating' | 'polling'
  const [fileForUpload, setFileForUpload] = useState(null);
  const [stagedData, setStagedData] = useState(null);
  const [fileId, setFileId] = useState(null);
  const fetcher = useFetcher();

  // Notify parent about processing state
  useEffect(() => {
    if (onProcessingChange) {
      onProcessingChange(uploadStep !== 'idle');
    }
  }, [uploadStep, onProcessingChange]);

  // Handle fetcher results for stage and create
  useEffect(() => {
    if (fetcher.data && uploadStep === 'staging') {
      if (fetcher.data.error) {
        setError(fetcher.data.error);
        setUploadStep('idle');
      } else {
        setStagedData(fetcher.data);
        setUploadStep('uploading');
      }
    }
    if (fetcher.data && uploadStep === 'creating') {
      if (fetcher.data.error && fetcher.data.status !== 202) {
        setError(fetcher.data.error);
        setUploadStep('idle');
      } else if (fetcher.data.imageUrl) {
        setImageUrl(fetcher.data.imageUrl);
        onImageUpload(fetcher.data.imageUrl);
        setUploadStep('idle');
      } else if (fetcher.data.fileId) {
        setFileId(fetcher.data.fileId);
        setUploadStep('polling');
      }
    }
    // eslint-disable-next-line
  }, [fetcher.data, uploadStep]);

  // Poll for image URL if file is still processing
  useEffect(() => {
    let pollInterval;
    if (uploadStep === 'polling' && fileId) {
      const poll = async () => {
        try {
          const res = await fetch(`/api/upload?fileId=${encodeURIComponent(fileId)}`);
          const data = await res.json();
          if (data.imageUrl) {
            setImageUrl(data.imageUrl);
            onImageUpload(data.imageUrl);
            setUploadStep('idle');
            setFileId(null);
          } else if (data.status === 'processing') {
            // keep polling, do not set error
          } else if (data.error) {
            setError(data.error);
            setUploadStep('idle');
            setFileId(null);
          }
        } catch (err) {
          setError(err.message);
          setUploadStep('idle');
          setFileId(null);
        }
      };
      pollInterval = setInterval(poll, 2000);
      poll();
    }
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [uploadStep, fileId, onImageUpload]);

  // Step 2: Upload to S3 when stagedData is set
  useEffect(() => {
    if (uploadStep === 'uploading' && stagedData && fileForUpload) {
      (async () => {
        try {
          if (!stagedData.parameters) {
            setError('Upload parameters missing. Please try again.');
            setUploadStep('idle');
            return;
          }
          const uploadForm = new FormData();
          stagedData.parameters.forEach(({ name, value }) => {
            uploadForm.append(name, value);
          });
          uploadForm.append('file', fileForUpload);
          const uploadResponse = await fetch(stagedData.url, {
            method: 'POST',
            body: uploadForm,
          });
          if (!uploadResponse.ok) throw new Error('Failed to upload file');
          // Now create the file in Shopify
          const createFormData = new FormData();
          createFormData.append('action', 'create');
          createFormData.append('resourceUrl', stagedData.resourceUrl);
          fetcher.submit(createFormData, { method: 'post', action: '/api/upload', encType: 'multipart/form-data' });
          setUploadStep('creating');
        } catch (err) {
          setError(err.message);
          setUploadStep('idle');
        }
      })();
    }
    // eslint-disable-next-line
  }, [uploadStep, stagedData, fileForUpload]);

  const handleDropZoneDrop = useCallback((_dropFiles = [], acceptedFiles = [], _rejectedFiles = []) => {
    setError(null);
    setUploadStep('staging');
    const imagefile = acceptedFiles[0];
    setFileForUpload(imagefile); // Save file for S3 upload
    // Step 1: Get staged upload URL
    const stageFormData = new FormData();
    stageFormData.append('action', 'stage');
    stageFormData.append('filename', imagefile.name);
    stageFormData.append('fileSize', imagefile.size.toString());
    stageFormData.append('mimeType', imagefile.type);
    fetcher.submit(stageFormData, { method: 'post', action: '/api/upload', encType: 'multipart/form-data' });
  }, [fetcher]);

  const validImageTypes = ['image/gif', 'image/jpeg', 'image/png', 'image/svg+xml'];
  const fileUpload = <DropZone.FileUpload actionTitle='Add image'/>;

  return (
    <div>
      {error && (
        <Banner status="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      <DropZone 
        accept={validImageTypes} 
        outline="true" 
        type="image" 
        allowMultiple={false}  
        onDrop={handleDropZoneDrop}
      >
        {uploadStep !== 'idle' ? (
          <div style={{display:"flex", alignItems:"center",justifyContent:"center",height:"100%"}}>
            <Spinner accessibilityLabel="Uploading image" size='large' />
          </div>
        ) : imageUrl ? (
          <div style={{display:"flex", alignItems:"center",justifyContent:"center",height:"100%"}}>
            <Thumbnail
              source={imageUrl}
              size="large"
              alt="Collection Image"
            />
          </div>
        ) : (
          fileUpload
        )}
      </DropZone>
    </div>
  );
} 