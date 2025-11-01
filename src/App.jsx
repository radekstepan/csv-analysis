import React, { useState, useCallback } from 'react';
import { Upload, Columns, FileDown, Bot, Sparkles, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';

// https://github.com/mlc-ai/web-llm/issues/683
const MODELS = [
  { name: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC", vram: "3.9 GB" },
  { name: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", vram: "5.1 GB" },
  { name: "Phi-3.5-mini-instruct-q4f16_1-MLC", vram: "3.7 GB" },
  { name: "Llama-3.2-3B-Instruct-q4f16_1-MLC", vram: "2.3 GB" },
  { name: "Llama-3.2-1B-Instruct-q4f16_1-MLC", vram: "880 MB" }
];

const MODEL = MODELS[0].name; // Default

/**
 * A simple CSV parser that handles quoted strings.
 * @param {string} text - The raw CSV text.
 * @returns {{headers: string[], data: Record<string, string>[]}}
 */
function parseCSV(text) {
  try {
    const rows = text.trim().split('\n');
    
    // Extract headers, trim and remove quotes
    const headers = rows[0].split(',').map(h => 
      h.trim().replace(/^"|"$/g, '')
    );
    
    const data = rows.slice(1).map(row => {
      const values = [];
      let inQuote = false;
      let value = '';
      
      // Manual parser loop to handle commas inside quotes
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        
        if (char === '"' && (i === 0 || row[i-1] !== '\\')) {
          inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
          values.push(value.trim());
          value = '';
        } else {
          value += char;
        }
      }
      values.push(value.trim()); // push last value

      // Filter out empty rows
      if (values.length === 1 && values[0] === "") {
        return null;
      }

      if (values.length !== headers.length) {
        console.warn("Row length mismatch, skipping row:", row);
        return null; // Skip rows that don't match header count
      }

      return headers.reduce((obj, header, i) => {
        // Clean quotes from value
        let finalVal = values[i];
        if (finalVal && finalVal.startsWith('"') && finalVal.endsWith('"')) {
          finalVal = finalVal.substring(1, finalVal.length - 1);
        }
        obj[header] = finalVal;
        return obj;
      }, {});
    }).filter(row => row !== null); // filter out skipped rows
    
    return { headers, data };
  } catch (error) {
    console.error("CSV parsing error:", error);
    throw new Error("Failed to parse CSV file. Please check the file format.");
  }
}

/**
 * A simple CSV stringifier.
 * @param {Record<string, string>[]} data - Array of data objects.
 * @returns {string} - The CSV content as a string.
 */
function stringifyCSV(data) {
  if (!data || data.length === 0) return "";
  
  const headers = Object.keys(data[0]);
  const headerRow = headers.join(',') + '\n';
  
  const body = data.map(row => {
    return headers.map(header => {
      let value = String(row[header] || '');
      // Add quotes if value contains a comma
      if (value.includes(',')) {
        value = `"${value.replace(/"/g, '""')}"`; // Escape double quotes
      }
      return value;
    }).join(',');
  }).join('\n');
  
  return headerRow + body;
}

// Main App Component
export default function App() {
  const [webllm, setWebllm] = useState(null);
  const [model, setModel] = useState(null);
  const [modelLoadingProgress, setModelLoadingProgress] = useState('Idle');
  
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [data, setData] = useState([]);
  
  const [selectedColumn, setSelectedColumn] = useState('');
  const [analysisType, setAnalysisType] = useState('sentiment'); // 'sentiment' or 'categorize'
  const [customCategories, setCustomCategories] = useState('Bug, Feature Request, Question, Other');
  const [customPrompt, setCustomPrompt] = useState('Categorize the following customer feedback:');
  
  const [processing, setProcessing] = useState(false);
  const [outputData, setOutputData] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // 1. Load the WebLLM library
  const loadWebllmModule = async () => {
    if (webllm) return webllm;
    
    try {
      setModelLoadingProgress("Loading WebLLM library...");
      // Reverting to esm.run, as it was the most likely to load the module
      // The previous errors were likely runtime errors, not import errors.
      const webllmModule = await import("https://esm.run/@mlc-ai/web-llm");
      setWebllm(webllmModule);
      return webllmModule;
    } catch (e) {
      setErrorMessage("Failed to load WebLLM library. Please refresh.");
      console.error(e);
      return null;
    }
  };

  // 2. Load the AI Model
  const loadModel = useCallback(async (modelName = selectedModel.name) => {
    let webllmModule = webllm;
    if (!webllmModule) {
      webllmModule = await loadWebllmModule();
      if (!webllmModule) return;
    }
    
    setErrorMessage('');
    setProgressPercent(0);
    setShowLoadingModal(true);
    setModelLoadingProgress('Initializing AI engine...');
    
    try {
      // Use a small, fast model for browser use
      const engine = await webllmModule.CreateMLCEngine(
        modelName,
        { // engineConfig
          initProgressCallback: (progress) => {
            setModelLoadingProgress(`Loading: ${progress.text}`);
            const match = progress.text.match(/(\d+)%/);
            if (match) {
              setProgressPercent(parseInt(match[1]));
            }
          }
        },
        { // appConfig - this is the correct place for workerUrl
          // Pointing to a stable CDN for the worker script
          workerUrl: "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/dist/web-llm-worker.js"
        }
      );
      setModel(engine);
      setModelLoadingProgress(`AI Model Ready! (${modelName})`);
      setShowLoadingModal(false);
    } catch (e) {
      setErrorMessage(`Model load error: ${e.message}`);
      setModelLoadingProgress('Idle');
      setProgressPercent(0);
      setShowLoadingModal(false);
      console.error(e);
    }
  }, [webllm, selectedModel.name]);
  
  // 3. Handle File Upload
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    
    setFile(f);
    setErrorMessage('');
    setOutputData([]); // Clear previous results
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const { headers, data } = parseCSV(text);
        
        if (headers.length === 0 || data.length === 0) {
          setErrorMessage("CSV file is empty or invalid.");
          return;
        }

        setHeaders(headers);
        setData(data);
        setSelectedColumn(headers[0]); // Default to first column
      } catch (err) {
        setErrorMessage(err.message);
        setHeaders([]);
        setData([]);
      }
    };
    reader.onerror = () => {
       setErrorMessage("Failed to read the file.");
    }
    reader.readAsText(f);
  };
  
  // 4. Process the Data
  const handleProcess = async () => {
    if (!model || !data.length || !selectedColumn) {
      setErrorMessage("Please load model, upload file, and select a column.");
      return;
    }
    
    if (analysisType === 'categorize' && !customCategories) {
      setErrorMessage("Please provide categories for analysis.");
      return;
    }
    
    setProcessing(true);
    setErrorMessage('');
    setOutputData([]);
    setProcessingProgress(0);
    
    const newColumnName = analysisType === 'sentiment' ? 'sentiment' : 'category';
    let processedData = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const textToAnalyze = row[selectedColumn];
      
      let systemPrompt = '';
      if (analysisType === 'sentiment') {
        systemPrompt = "Analyze the sentiment of the following text. Respond with exactly one word: 'Positive', 'Negative', or 'Neutral'. Do not include any other text, punctuation, or explanations.";
      } else {
        systemPrompt = `${customPrompt}. Classify the following text into one of these categories: [${customCategories}]. Respond with only one of the provided category names and nothing else. Do not add punctuation or explanations.`;
      }
      
      const newRow = { ...row };
      
      try {
        if (!textToAnalyze || textToAnalyze.trim() === "") {
            throw new Error("Empty text");
        }

        const reply = await model.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: textToAnalyze }
          ],
          temperature: 0.1, // Low temp for classification
        });
        
        let result = reply.choices[0].message.content.trim();
        
        // Clean up <think> tags from reasoning models like DeepSeek
        if (result.includes('<think>') && result.includes('</think>')) {
          const parts = result.split('</think>');
          result = parts[parts.length - 1].trim();
        }
        
        newRow[newColumnName] = result;
        
      } catch (e) {
        console.error(`Error processing row ${i + 1}:`, e);
        newRow[newColumnName] = "PROCESSING_ERROR";
        // Update error message but don't stop processing
        setErrorMessage(`Error on row ${i + 1}. Check console for details.`);
      }
      
      processedData.push(newRow);
      // Update state in batches to avoid too many re-renders
      setProcessingProgress(Math.round(((i + 1) / data.length) * 100));
      if (i % 5 === 0 || i === data.length - 1) {
        setOutputData([...processedData]);
      }
    }
    
    setProcessing(false);
  };
  
  // 5. Download Processed CSV
  const handleDownload = () => {
    if (outputData.length === 0) return;
    
    try {
      const csvContent = stringifyCSV(outputData);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      
      link.setAttribute("href", url);
      link.setAttribute("download", `processed_${file.name}`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (e) {
      setErrorMessage(`Failed to create download: ${e.message}`);
      console.error(e);
    }
  };
  
  // Helper to render table headers
  const renderTableHeaders = () => {
    let currentHeaders = [];
    if (outputData.length > 0) {
      currentHeaders = Object.keys(outputData[0]);
    } else if (data.length > 0) {
      currentHeaders = headers;
    }
    
    return currentHeaders.map((h) => (
      <th key={h} className={`p-3 text-left text-sm font-semibold text-gray-700 whitespace-nowrap sticky top-0 bg-gray-100 ${h === 'sentiment' || h === 'category' ? 'bg-blue-100' : ''}`}>
        {h}
      </th>
    ));
  };
  
  // Helper to render table rows
  const renderTableRows = () => {
    const rowsToRender = outputData.length > 0 ? outputData : data;
    
    return rowsToRender.map((row, rowIndex) => (
      <tr key={rowIndex} className="border-b border-gray-200 hover:bg-gray-50">
        {Object.entries(row).map(([key, value], cellIndex) => (
          <td key={cellIndex} className={`p-3 text-sm text-gray-600 ${key === 'sentiment' || key === 'category' ? 'bg-blue-50 font-medium text-blue-800' : ''}`}>
            {value}
          </td>
        ))}
      </tr>
    ));
  };

  // Main UI
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans text-gray-900 p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-4xl font-bold text-center text-blue-700">WebLLM CSV Analyzer</h1>
        <p className="text-lg text-center text-gray-600 mt-2">Process your CSV files with AI, 100% in your browser. Your data never leaves your computer.</p>
      </header>

      {errorMessage && (
        <div className="mb-4 p-4 bg-red-100 border border-red-300 text-red-800 rounded-lg flex items-center">
          <AlertTriangle className="h-5 w-5 mr-3" />
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="ml-auto font-bold text-lg">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* === COLUMN 1: CONTROLS === */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* --- Step 1: Load Model --- */}
          <div className="bg-white p-5 pb-6 rounded-lg shadow-md border-gray-200 min-h-40">
            <h2 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold mr-3">1</span>
              Load AI Model
            </h2>
            <div className="relative">
              <div className="flex">
                <button
                  onClick={() => loadModel(MODELS[0].name)}
                  disabled={model || modelLoadingProgress.startsWith('Loading') || modelLoadingProgress.startsWith('Initializing')}
                  className="flex-1 flex items-center justify-center px-4 py-3 bg-blue-600 text-white font-semibold rounded-l-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  {modelLoadingProgress.startsWith('Loading') || modelLoadingProgress.startsWith('Initializing') ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Bot className="mr-2 h-5 w-5" />
                  )}
                  {model ? "Model Loaded" : "Load Model"}
                </button>
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="px-3 py-3 bg-blue-600 text-white rounded-r-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  disabled={model || modelLoadingProgress.startsWith('Loading') || modelLoadingProgress.startsWith('Initializing')}
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              </div>
              {showModelDropdown && (
                <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg z-10">
                  {MODELS.map(model => (
                    <button key={model.name} onClick={() => { 
                      setSelectedModel(model); 
                      setModel(null); 
                      setModelLoadingProgress('Idle'); 
                      setShowModelDropdown(false); 
                      loadModel(model.name); 
                    }} className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm">
                      <div className="font-medium">{model.name}</div>
                      <div className="text-gray-500">{model.vram} VRAM</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!showLoadingModal && (
              <p className="text-sm text-gray-500 text-center mt-3">
                {modelLoadingProgress}
              </p>
            )}
          </div>
          
          {/* --- Step 2: Upload File --- */}
          <fieldset disabled={!model} className="disabled:opacity-50">
            <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold mr-3">2</span>
                Upload CSV
              </h2>
              <label htmlFor="file-upload" className="w-full flex flex-col items-center px-4 py-6 bg-gray-50 text-blue-600 rounded-lg shadow-inner border border-dashed border-gray-300 cursor-pointer hover:bg-blue-50">
                <Upload className="h-8 w-8" />
                <span className="mt-2 text-base font-medium">{file ? file.name : "Click to upload a .csv file"}</span>
              </label>
              <input id="file-upload" type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
            </div>
          </fieldset>

          {/* --- Step 3: Configure & Run --- */}
          <fieldset disabled={!model || data.length === 0 || processing} className="disabled:opacity-50">
            <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold mr-3">3</span>
                Configure & Process
              </h2>
              
              <div className="space-y-4">
                {/* Column Selection */}
                <div>
                  <label htmlFor="column-select" className="block text-sm font-medium text-gray-700 mb-1">
                    Column to Analyze
                  </label>
                  <select
                    id="column-select"
                    value={selectedColumn}
                    onChange={(e) => setSelectedColumn(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                
                {/* Analysis Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Analysis Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input type="radio" value="sentiment" checked={analysisType === 'sentiment'} onChange={() => setAnalysisType('sentiment')} className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                      <span className="ml-2 text-sm text-gray-700">Sentiment</span>
                    </label>
                    <label className="flex items-center">
                      <input type="radio" value="categorize" checked={analysisType === 'categorize'} onChange={() => setAnalysisType('categorize')} className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                      <span className="ml-2 text-sm text-gray-700">Categorize</span>
                    </label>
                  </div>
                </div>
                
                {/* Conditional Inputs */}
                {analysisType === 'categorize' && (
                  <div className="space-y-3 p-4 border border-gray-200 rounded-md bg-gray-50">
                    <div>
                      <label htmlFor="custom-prompt" className="block text-sm font-medium text-gray-700 mb-1">
                        Custom Prompt
                      </label>
                      <textarea
                        id="custom-prompt"
                        rows="2"
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="custom-categories" className="block text-sm font-medium text-gray-700 mb-1">
                        Categories (comma-separated)
                      </label>
                      <input
                        type="text"
                        id="custom-categories"
                        value={customCategories}
                        onChange={(e) => setCustomCategories(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
                
                {/* Process Button */}
                <button
                  onClick={handleProcess}
                  disabled={processing}
                  className="w-full flex items-center justify-center px-4 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  {processing ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-5 w-5" />
                  )}
                  {processing ? `Processing... (${outputData.length}/${data.length})` : "Start Processing"}
                </button>
              </div>
            </div>
          </fieldset>
        </div>
        
        {/* === COLUMN 2: RESULTS === */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-5 rounded-lg shadow-md border border-gray-200">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center">
                <Columns className="mr-3 h-6 w-6 text-gray-600" />
                Data Preview
              </h2>
              <button
                onClick={handleDownload}
                disabled={outputData.length === 0 || processing}
                className="mt-3 sm:mt-0 w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <FileDown className="mr-2 h-4 w-4" />
                Download Processed CSV
              </button>
            </div>
            
            {processing && (
              <div className="mb-4">
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                  <div className="bg-green-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${processingProgress}%` }}></div>
                </div>
                <p className="text-sm text-gray-600 text-center">{processingProgress}% completed</p>
              </div>
            )}
            
            {/* Table Preview */}
            <div className="w-full overflow-x-auto border border-gray-200 rounded-lg max-h-[70vh]">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>{renderTableHeaders()}</tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {renderTableRows()}
                  {data.length === 0 && (
                    <tr>
                      <td colSpan={headers.length || 1} className="p-6 text-center text-gray-500">
                        Upload a CSV file to see a preview of your data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
      </div>

      {showLoadingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-lg w-full mx-4">
            <div className="flex items-center mb-4">
              <Loader2 className="mr-3 h-6 w-6 animate-spin text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-800">Loading AI Model</h3>
            </div>
            <p className="text-sm text-gray-500 mb-2">Model: {selectedModel.name}</p>
            <p className="text-sm text-gray-600 whitespace-pre-line">{modelLoadingProgress}</p>
          </div>
        </div>
      )}
    </div>
  );
}
