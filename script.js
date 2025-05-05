document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas Elements ---
    const canvasContainer = document.querySelector('.canvas-container');
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Performance hint
    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayCtx = overlayCanvas.getContext('2d');

    // --- Toolbar Elements ---
    const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
    const colorPicker = document.getElementById('colorPicker');
    const lineWidthSlider = document.getElementById('lineWidth');
    const lineWidthValue = document.getElementById('lineWidthValue');
    const fontSizeInput = document.getElementById('fontSize');
    const fontSizeLabel = document.getElementById('fontSizeLabel');
    const fontSizeUnit = document.getElementById('fontSizeUnit');
    const clearBtn = document.getElementById('clearBtn');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const exportBtn = document.getElementById('exportBtn');

    // --- State Variables ---
    let currentTool = 'pen'; // Default tool
    let currentColor = colorPicker.value;
    let currentWidth = lineWidthSlider.value;
    let currentFontSize = fontSizeInput.value;

    let isDrawing = false; // For freehand/shape creation drag
    let isDragging = false; // For moving existing objects
    let startX, startY;
    let selectedObject = null;
    let dragOffsetX, dragOffsetY;

    // *** OBJECT MODEL & HISTORY ***
    let canvasObjects = []; // Holds text and shape objects
    let history = []; // Stores snapshots of canvasObjects + freehand pixels
    let historyIndex = -1;
    let freehandSnapshot = null; // Stores pixel data before object drag

    // --- Canvas Setup ---
    function resizeCanvases() {
        // Capture *both* object state and pixel state before resize
        const objectState = JSON.stringify(canvasObjects);
        let pixelState = null;
        try {
             // Only capture if canvas has dimensions
             if (canvas.width > 0 && canvas.height > 0) {
                pixelState = ctx.getImageData(0, 0, canvas.width, canvas.height);
             }
        } catch(e) {
            console.error("Could not get ImageData during resize:", e);
        }

        const width = canvasContainer.offsetWidth;
        const height = canvasContainer.offsetHeight;
        canvas.width = width;
        canvas.height = height;
        overlayCanvas.width = width;
        overlayCanvas.height = height;

        // Restore state after setting new dimensions
        if (pixelState) {
            ctx.putImageData(pixelState, 0, 0); // Restore pixels first
        } else {
             ctx.clearRect(0, 0, width, height); // Clear if no previous state
        }
        try {
             canvasObjects = JSON.parse(objectState); // Restore objects
        } catch(e){
             console.error("Error parsing object state on resize", e);
             canvasObjects = []; // Reset objects on error
        }
        redrawObjects(); // Redraw objects on top of pixels

        overlayCtx.clearRect(0, 0, width, height);
        console.log(`Canvases resized to: ${width}x${height}`);
    }

    // --- Style Setting Utility ---
    function setContextStyle(context, tool, obj = null) {
        const color = obj ? obj.color : currentColor;
        const width = obj ? obj.lineWidth : currentWidth;
        const font = obj ? obj.font : `${currentFontSize}px sans-serif`;

        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = width;
        context.font = font;
        context.lineJoin = 'round'; // Keep round joins for now

        const effectiveTool = obj ? obj.type : tool; // Use object type if available

        switch (effectiveTool) {
            case 'pen':
                context.globalCompositeOperation = 'source-over';
                context.globalAlpha = 1.0;
                context.lineCap = 'round';
                break;
            case 'highlighter':
                context.globalCompositeOperation = 'multiply';
                context.globalAlpha = 0.4;
                context.lineCap = 'butt';
                break;
            case 'eraser':
                context.globalCompositeOperation = 'destination-out';
                context.globalAlpha = 1.0;
                context.lineCap = 'square'; // SQUARE ERASER
                break;
            // No 'fill' case needed here
            case 'line':
            case 'rectangle':
            case 'circle':
            case 'text': // Apply standard settings for drawing objects
                context.globalCompositeOperation = 'source-over';
                context.globalAlpha = 1.0;
                context.lineCap = obj ? (obj.lineCap || 'round') : 'round';
                break;
            default: // Default for previews or unknown
                context.globalCompositeOperation = 'source-over';
                context.globalAlpha = 1.0;
                context.lineCap = 'round';
                break;
        }
    }

    // --- OBJECT DRAWING ---
    function redrawObjects() {
        // This function *only* draws the objects from the canvasObjects array
        // It does NOT clear the canvas first, preserving freehand pixel data underneath
        canvasObjects.forEach(obj => {
            if (!obj) return; // Skip if object is somehow null/undefined
            setContextStyle(ctx, obj.type, obj); // Set style based on object props

            ctx.beginPath(); // Start new path for each object
            try {
                switch (obj.type) {
                    case 'line':
                        ctx.moveTo(obj.startX, obj.startY);
                        ctx.lineTo(obj.endX, obj.endY);
                        ctx.stroke();
                        break;
                    case 'rectangle':
                        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
                        break;
                    case 'circle':
                        ctx.arc(obj.centerX, obj.centerY, obj.radius, 0, Math.PI * 2);
                        ctx.stroke();
                        break;
                    case 'text':
                        ctx.font = obj.font; // Ensure font is set just before drawing text
                        ctx.fillText(obj.text, obj.x, obj.y);
                        break;
                }
            } catch (e) {
                console.error("Error drawing object:", obj, e);
            }
            // Draw selection highlight if this object is selected
            if (obj === selectedObject) {
                 drawSelectionHighlight(obj);
            }
        });
        // Restore drawing style for the currently selected tool after drawing all objects
        setContextStyle(ctx, currentTool);
    }

     function drawSelectionHighlight(obj) {
        if (!obj) return;
        // Example: draw a dashed bounding box
        ctx.save(); // Save current style
        ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]); // Dashed line
        ctx.globalCompositeOperation = 'source-over'; // Ensure visible
        ctx.globalAlpha = 1.0;

        const bounds = getObjectBounds(obj);
        if (bounds) {
            // Add padding for visibility
            ctx.strokeRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6);
        }

        ctx.restore(); // Restore previous style
        ctx.setLineDash([]); // Reset line dash
    }


    // --- Redraw Everything (Pixels + Objects) ---
    function redrawAll() {
        // 1. Clear main canvas completely
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 2. Restore pixel snapshot IF available (used during dragging)
        if (freehandSnapshot) {
            try {
                ctx.putImageData(freehandSnapshot, 0, 0);
            } catch(e) {
                console.error("Error restoring snapshot:", e);
                // Clear if snapshot fails?
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
        // If no snapshot, it means freehand drawing happened since last save,
        // or we are doing a fresh redraw. The underlying pixel data is implicitly there or cleared.

        // 3. Redraw all vector objects on top
        redrawObjects();
    }


    // --- OBJECT HIT DETECTION & BOUNDS ---
    function getObjectBounds(obj) {
        if (!obj) return null;
        const padding = 5; // Click padding, adjust as needed
        try {
            switch (obj.type) {
                case 'rectangle':
                    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
                case 'line':
                    // Bounding box for line
                    const minX = Math.min(obj.startX, obj.endX) - padding;
                    const minY = Math.min(obj.startY, obj.endY) - padding;
                    const maxX = Math.max(obj.startX, obj.endX) + padding;
                    const maxY = Math.max(obj.startY, obj.endY) + padding;
                    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
                case 'circle':
                    return {
                        x: obj.centerX - obj.radius - padding,
                        y: obj.centerY - obj.radius - padding,
                        width: (obj.radius + padding) * 2,
                        height: (obj.radius + padding) * 2
                    };
                case 'text':
                    // Measure text - Approximation!
                    setContextStyle(ctx, 'text', obj); // Apply object's font for measurement
                    const metrics = ctx.measureText(obj.text);
                    // Estimate height based on font size (common approximation)
                    const fontSizeNum = parseFloat(obj.font || '16px');
                    const heightApproximation = fontSizeNum * 1.2;
                    return {
                        x: obj.x - padding,
                        // Adjust y based on font baseline (assuming text starts slightly above y)
                        y: obj.y - fontSizeNum + padding,
                        width: metrics.width + padding * 2,
                        height: heightApproximation + padding * 2
                    };
                default:
                    return null;
            }
        } catch (e) {
            console.error("Error getting bounds for object:", obj, e);
            return null;
        }
    }

    function isPointInBounds(x, y, bounds) {
        return bounds && x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }

    // Line specific hit detection (more precise than just bounds)
    function isPointOnLine(px, py, line, tolerance = 5) {
        if (!line) return false;
        const { startX: x1, startY: y1, endX: x2, endY: y2 } = line;
        // Add lineWidth to tolerance
        const effectiveTolerance = Math.max(tolerance, (line.lineWidth || currentWidth) / 2);

        // Handle vertical lines
        if (Math.abs(x1 - x2) < 0.1) {
             return Math.abs(px - x1) <= effectiveTolerance && py >= Math.min(y1, y2) - effectiveTolerance && py <= Math.max(y1, y2) + effectiveTolerance;
        }
        // Handle horizontal lines
        if (Math.abs(y1 - y2) < 0.1) {
             return Math.abs(py - y1) <= effectiveTolerance && px >= Math.min(x1, x2) - effectiveTolerance && px <= Math.max(x1, x2) + effectiveTolerance;
        }

        // Standard line distance calculation
        const lenSq = Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2);
        if (lenSq === 0) return false; // Line has zero length

        const t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lenSq;
        const tClamped = Math.max(0, Math.min(1, t)); // Clamp t to the segment

        const closestX = x1 + tClamped * (x2 - x1);
        const closestY = y1 + tClamped * (y2 - y1);

        const distSq = Math.pow(px - closestX, 2) + Math.pow(py - closestY, 2);
        return distSq <= effectiveTolerance * effectiveTolerance;
    }


    function getObjectAtPosition(x, y) {
        // Iterate backwards through objects array to select topmost object first
        for (let i = canvasObjects.length - 1; i >= 0; i--) {
            const obj = canvasObjects[i];
            if (!obj) continue; // Skip if object is null/undefined

            if (obj.type === 'line') {
                 if (isPointOnLine(x, y, obj)) {
                    return obj;
                 }
            } else {
                 const bounds = getObjectBounds(obj);
                 if (isPointInBounds(x, y, bounds)) {
                    // Optional: More precise check for circle
                    if (obj.type === 'circle') {
                        const distSq = Math.pow(x - obj.centerX, 2) + Math.pow(y - obj.centerY, 2);
                        const effectiveRadius = obj.radius + Math.max(5, (obj.lineWidth || currentWidth) / 2);
                        if (distSq <= effectiveRadius * effectiveRadius) return obj;
                    } else {
                         return obj; // Hit within bounds for rect/text
                    }
                }
            }
        }
        return null; // No object found
    }


    // --- Drawing Logic Handlers ---
    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY;
        // Basic check for valid coordinates
        if (clientX === undefined || clientY === undefined) return null;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function handlePointerDown(e) {
        const pos = getPointerPos(e);
        if (!pos) return; // Exit if pointer position is invalid

        startX = pos.x;
        startY = pos.y;

        isDrawing = false; // Reset flags
        isDragging = false;

        if (currentTool === 'select') {
            selectedObject = getObjectAtPosition(startX, startY);
            if (selectedObject) {
                isDragging = true;
                // Calculate offset from object origin
                const bounds = getObjectBounds(selectedObject);
                let originX = bounds?.x ?? selectedObject.x ?? startX; // Fallback origin
                let originY = bounds?.y ?? selectedObject.y ?? startY;
                // Adjust origin for specific types if needed
                if(selectedObject.type === 'circle'){ originX = selectedObject.centerX; originY = selectedObject.centerY; }
                else if (selectedObject.type === 'line'){ originX = selectedObject.startX; originY = selectedObject.startY; }

                dragOffsetX = startX - originX;
                dragOffsetY = startY - originY;

                // Snapshot pixel data *before* starting drag redraws
                try {
                    freehandSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
                } catch(er) {
                     console.error("Error getting snapshot:", er);
                     freehandSnapshot = null; // Continue without snapshot if error
                }
                redrawAll(); // Redraw to show selection highlight
            } else {
                selectedObject = null; // Clicked empty space
                redrawAll(); // Redraw to remove previous selection highlight
            }
        }
        else if (currentTool === 'text') {
            // Text is placed on pointer down, not drag
            placeText(startX, startY);
        }
        else if (currentTool === 'fill') {
             // Ensure objects are rendered onto the main canvas before filling
             redrawObjects(); // Make sure object outlines are part of pixel data
             // Use integer coordinates for pixel operations
             floodFill(Math.floor(startX), Math.floor(startY), hexToRgba(currentColor));
             saveState(); // Save after fill is complete
        }
        else { // Pen, Highlighter, Eraser, Shape tools initiate drawing
            isDrawing = true;
            selectedObject = null; // Deselect any object

            const targetCtx = (currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') ? overlayCtx : ctx;
            setContextStyle(targetCtx, currentTool); // Set style before drawing

            if (currentTool === 'pen' || currentTool === 'highlighter' || currentTool === 'eraser') {
                 freehandSnapshot = null; // Clear snapshot if starting freehand
                 targetCtx.beginPath();
                 targetCtx.moveTo(startX, startY);
            } else { // Shapes
                overlayCanvas.style.pointerEvents = 'auto'; // Allow interaction with overlay
                 // Shape preview is drawn fresh in handlePointerMove
            }
        }
        e.preventDefault(); // Prevent default browser actions like text selection or page scroll
    }

    function handlePointerMove(e) {
        const pos = getPointerPos(e);
        if (!pos || (!isDrawing && !isDragging)) return; // Exit if no position or not active

        const currentX = pos.x;
        const currentY = pos.y;

        if (isDragging && selectedObject) {
             // Calculate new object position based on drag offset
             let newX = currentX - dragOffsetX;
             let newY = currentY - dragOffsetY;

             // Update object properties based on type
             if (selectedObject.type === 'rectangle') {
                 selectedObject.x = newX; selectedObject.y = newY;
             } else if (selectedObject.type === 'circle') {
                 selectedObject.centerX = newX; selectedObject.centerY = newY;
             } else if (selectedObject.type === 'text') {
                 selectedObject.x = newX; selectedObject.y = newY;
             } else if (selectedObject.type === 'line') {
                  // Move whole line relative to start point drag
                  const dx = newX - selectedObject.startX; const dy = newY - selectedObject.startY;
                  selectedObject.startX += dx; selectedObject.startY += dy;
                  selectedObject.endX += dx; selectedObject.endY += dy;
             }

            // Redraw *everything* during drag (clear, restore snapshot, draw objects)
            redrawAll();

        } else if (isDrawing) {
            if (currentTool === 'pen' || currentTool === 'highlighter' || currentTool === 'eraser') {
                // Draw directly on main canvas
                setContextStyle(ctx, currentTool); // Ensure style is current
                ctx.lineTo(currentX, currentY);
                ctx.stroke(); // Draw the segment
            }
            else if (currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') {
                // Draw shape PREVIEW on overlay
                setContextStyle(overlayCtx, 'pen'); // Use default pen style for preview outline
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                overlayCtx.beginPath();
                if (currentTool === 'line') {
                    overlayCtx.moveTo(startX, startY); overlayCtx.lineTo(currentX, currentY);
                } else if (currentTool === 'rectangle') {
                    overlayCtx.rect(startX, startY, currentX - startX, currentY - startY);
                } else if (currentTool === 'circle') {
                    const radius = Math.hypot(currentX - startX, currentY - startY); // Use hypot for distance
                    overlayCtx.arc(startX, startY, radius, 0, Math.PI * 2);
                }
                overlayCtx.stroke();
            }
        }
        e.preventDefault();
    }

    function handlePointerUp(e) {
        const wasDrawing = isDrawing; // Store flags before resetting
        const wasDragging = isDragging;

        isDrawing = false;
        isDragging = false;

        overlayCanvas.style.pointerEvents = 'none'; // Disable overlay interaction
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); // Clear preview

        const pos = getPointerPos(e); // Get final position
        // Use last known good position if pointerup happens outside? For simplicity, use current pos if available
        const endX = pos?.x ?? startX; // Fallback to startX if pos is null
        const endY = pos?.y ?? startY; // Fallback to startY if pos is null

        // *** Finalize Operations ***
        if (wasDragging && selectedObject) {
            // Drag finished, object is already updated in memory.
             freehandSnapshot = null; // Clear the snapshot used during drag
             redrawAll(); // Final redraw without snapshot base
             saveState(); // Save the new object position state
             // Keep object selected after drag

        } else if (wasDrawing) {
            // Create Object or Finalize Stroke
            if (currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') {
                 // Create shape OBJECT and add to array
                 let newObject = null;
                 const commonProps = {
                      color: currentColor,
                      lineWidth: currentWidth,
                      lineCap: 'round' // Default, can be customized later
                 };
                 if (currentTool === 'line') {
                      // Only create if line has significant length
                      if(Math.hypot(endX - startX, endY - startY) > 2) {
                           newObject = { ...commonProps, type: 'line', startX, startY, endX, endY };
                      }
                 } else if (currentTool === 'rectangle') {
                       const width = endX - startX;
                       const height = endY - startY;
                       // Only create if rectangle has significant size
                       if(Math.abs(width) > 2 && Math.abs(height) > 2) {
                            newObject = { ...commonProps, type: 'rectangle', x: Math.min(startX, endX), y: Math.min(startY, endY), width: Math.abs(width), height: Math.abs(height) };
                       }
                 } else if (currentTool === 'circle') {
                      const radius = Math.hypot(endX - startX, endY - startY);
                       // Only create if circle has significant radius
                       if (radius > 2) {
                            newObject = { ...commonProps, type: 'circle', centerX: startX, centerY: startY, radius };
                       }
                 }

                 if (newObject) {
                      canvasObjects.push(newObject);
                      redrawObjects(); // Draw the new object permanently onto the main canvas
                      saveState(); // Save state including the new object
                 }

            } else if (currentTool === 'pen' || currentTool === 'highlighter' || currentTool === 'eraser') {
                // Freehand stroke finished drawing directly on ctx.
                // Need to ensure the path is 'closed' conceptually for history saving
                ctx.beginPath(); // Start a new path to avoid affecting future strokes
                saveState(); // Save the pixel state including the new stroke.
            }
        } else if (currentTool === 'select' && !selectedObject && !wasDragging) {
            // Clicked empty space with select tool without dragging - deselect
             selectedObject = null;
             redrawAll(); // Redraw to remove highlight if any
        } else if (currentTool === 'fill') {
            // Fill happens on pointer down, do nothing on up
        } else if (currentTool === 'text') {
            // Text happens on pointer down, do nothing on up
        }

        // Reset temporary states after operation concludes
        freehandSnapshot = null;
    }

    function placeText(x, y) {
        const text = prompt("Enter text:", "");
        if (text && text.trim() !== "") { // Only add if text is not empty
             const font = `${currentFontSize}px sans-serif`;
             const newTextObject = {
                 type: 'text',
                 text: text,
                 x: x,
                 y: y, // Note: y is the baseline position
                 color: currentColor,
                 font: font
             };
            canvasObjects.push(newTextObject);
            redrawObjects(); // Draw the new text object immediately
            saveState(); // Save state including the new text
        }
    }

    // --- FLOOD FILL IMPLEMENTATION ---

    function hexToRgba(hex) {
        // Handle potential shorthand hex (e.g., #F00)
        if(hex.length === 4){
            let r = parseInt(hex[1] + hex[1], 16);
            let g = parseInt(hex[2] + hex[2], 16);
            let b = parseInt(hex[3] + hex[3], 16);
            return [r, g, b, 255];
        }
        // Handle standard hex
        if (hex.length === 7){
            let r = parseInt(hex.slice(1, 3), 16);
            let g = parseInt(hex.slice(3, 5), 16);
            let b = parseInt(hex.slice(5, 7), 16);
            return [r, g, b, 255];
        }
        console.warn("Invalid hex color for fill:", hex);
        return [0, 0, 0, 255]; // Default to black if invalid
    }

    function getPixel(imageData, x, y) {
        if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
            return [-1, -1, -1, -1]; // Invalid coords marker
        }
        const index = (y * imageData.width + x) * 4;
        // Check if data exists at index (simple bounds check isn't always enough)
        if (index + 3 >= imageData.data.length) {
             return [-1, -1, -1, -1];
        }
        return [
            imageData.data[index],     // R
            imageData.data[index + 1], // G
            imageData.data[index + 2], // B
            imageData.data[index + 3]  // A
        ];
    }

    function setPixel(imageData, x, y, color) {
         if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return; // Bounds check
         const index = (y * imageData.width + x) * 4;
          // Ensure color array has 4 elements
         const r = color[0] ?? 0;
         const g = color[1] ?? 0;
         const b = color[2] ?? 0;
         const a = color[3] ?? 255;
         imageData.data[index] = r;
         imageData.data[index + 1] = g;
         imageData.data[index + 2] = b;
         imageData.data[index + 3] = a;
    }

    // Color comparison with tolerance for anti-aliasing
    function colorMatch(color1, color2, tolerance = 32) { // Increased tolerance slightly
        if (!color1 || !color2 || color1[0] === -1 || color2[0] === -1) return false; // Check for invalid colors

        // Treat very transparent pixels as matching other very transparent pixels
        if (color1[3] < 10 && color2[3] < 10) return true;
        // Don't match pixels with vastly different transparency
        if (Math.abs(color1[3] - color2[3]) > tolerance) return false;

        // Calculate color difference (Euclidean distance in RGB space)
        let diff = Math.sqrt(
            Math.pow(color1[0] - color2[0], 2) +
            Math.pow(color1[1] - color2[1], 2) +
            Math.pow(color1[2] - color2[2], 2)
        );
        return diff <= tolerance;
    }


    function floodFill(startX, startY, fillColor) {
        console.log("Starting flood fill...");
        let imageData;
        try {
             imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch(e) {
             console.error("Flood fill failed: Could not get canvas ImageData.", e);
             alert("Could not perform fill operation. Canvas may be tainted (e.g., cross-origin image).");
             return;
        }

        const startColor = getPixel(imageData, startX, startY);
        const width = imageData.width;
        const height = imageData.height;

        // Check if start point is valid and not already the target color
        if (startColor[0] === -1) {
             console.log("Fill start failed: Clicked outside canvas bounds.");
             return;
        }
        if (colorMatch(startColor, fillColor, 1)) { // Use low tolerance for exact match check
             console.log("Fill start failed: Clicked area is already the target color.");
             return;
        }

        const pixelQueue = [[startX, startY]]; // Queue of [x, y] coords
        const visited = new Uint8Array(width * height); // 0 = not visited, 1 = visited
        const startIndex = startY * width + startX;
        visited[startIndex] = 1; // Mark start pixel as visited immediately

        let iterations = 0;
        const maxIterations = width * height; // Safety break based on pixel count

        while (pixelQueue.length > 0 && iterations < maxIterations) {
            const [x, y] = pixelQueue.shift(); // Get pixel from front of queue

            // Current pixel color check (should match start color)
            const currentColor = getPixel(imageData, x, y);
            if (colorMatch(startColor, currentColor)) {
                setPixel(imageData, x, y, fillColor); // Set the fill color

                // Check neighbors (N, S, E, W)
                const neighbors = [
                    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
                ];

                for (const [nx, ny] of neighbors) {
                    // Check bounds
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const neighborIndex = ny * width + nx;
                        // Add to queue only if not visited
                        if (visited[neighborIndex] === 0) {
                             visited[neighborIndex] = 1; // Mark as visited when adding to queue
                             pixelQueue.push([nx, ny]);
                        }
                    }
                }
            }
             iterations++;
        } // End while loop

         if(iterations >= maxIterations){
            console.warn("Flood fill reached max iterations. May be incomplete.");
            alert("Fill operation took too long and was stopped. The area might be too large or complex.");
         }

        // Put the modified data back onto the canvas
        ctx.putImageData(imageData, 0, 0);
        console.log(`Flood fill finished after ${iterations} iterations.`);
    }


    // --- Event Listeners ---
    canvasContainer.addEventListener('pointerdown', handlePointerDown);
    canvasContainer.addEventListener('pointermove', handlePointerMove);
    // Listen on window for pointer up to catch cases where pointer is released outside canvas
    window.addEventListener('pointerup', handlePointerUp);

    // Toolbar Button Clicks
    toolBtns.forEach(btn => {
         btn.addEventListener('click', () => {
             toolBtns.forEach(b => b.classList.remove('active-tool'));
             btn.classList.add('active-tool');
             const newTool = btn.dataset.tool;
             // If switching away from select tool, deselect any object
             if (currentTool === 'select' && newTool !== 'select' && selectedObject) {
                 selectedObject = null;
                 redrawAll(); // Redraw to remove selection highlight
             }
             currentTool = newTool;
             updateCursor();
             toggleToolOptions();
         });
    });

    // Input listeners
    colorPicker.addEventListener('input', (e) => { currentColor = e.target.value; });
    lineWidthSlider.addEventListener('input', (e) => {
        currentWidth = e.target.value;
        lineWidthValue.textContent = currentWidth;
    });
    fontSizeInput.addEventListener('input', (e) => { currentFontSize = e.target.value; });

    // Action Buttons
    clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear everything?')) {
            canvasObjects = []; // Clear objects
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear pixels
            selectedObject = null; // Deselect
            freehandSnapshot = null; // Clear snapshot
            saveState(); // Save the cleared state
        }
    });

    exportBtn.addEventListener('click', () => {
         // Ensure everything is drawn before exporting
         redrawAll();
         // Optional: Draw white background if needed (if canvas bg is transparent)
         /*
         ctx.save();
         ctx.globalCompositeOperation = 'destination-over'; // Draw behind existing content
         ctx.fillStyle = '#ffffff'; // White background
         ctx.fillRect(0, 0, canvas.width, canvas.height);
         ctx.restore();
         */
         const dataURL = canvas.toDataURL('image/png');
         exportBtn.href = dataURL;
    });

    // --- HISTORY ---
    function saveState() {
        clearTimeout(window.saveTimeout); // Debounce saving
        window.saveTimeout = setTimeout(() => {
            if (historyIndex < history.length - 1) {
                history = history.slice(0, historyIndex + 1); // Clear redo history
            }

            // Save both object state and pixel state
            try {
                const state = {
                    objects: JSON.stringify(canvasObjects),
                    // Get pixel data only if canvas has dimensions
                    pixels: (canvas.width > 0 && canvas.height > 0) ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null
                };
                history.push(state);
                historyIndex = history.length - 1;
                updateUndoRedoButtons();
            } catch(e) {
                console.error("Error saving state:", e);
                // Optionally notify user or disable undo
            }

        }, 150); // Debounce slightly longer
    }

    function restoreState(index) {
        if (index < 0 || index >= history.length) return;

        const state = history[index];
        if (!state) return; // Should not happen, but safety check

        try { // Add error handling for parsing/restoring
             canvasObjects = JSON.parse(state.objects);
             if (state.pixels) {
                 ctx.putImageData(state.pixels, 0, 0); // Restore pixel data
             } else {
                  ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear if no pixel data saved
             }
             historyIndex = index;
             redrawObjects(); // Redraw restored objects (important!)
             updateUndoRedoButtons();
             selectedObject = null; // Deselect after undo/redo
        } catch(e) {
             console.error("Error restoring state:", e);
             alert("Could not restore previous state.");
             // Consider resetting history or handling the error gracefully
        }
    }

    undoBtn.addEventListener('click', () => { if (historyIndex > 0) restoreState(historyIndex - 1); });
    redoBtn.addEventListener('click', () => { if (historyIndex < history.length - 1) restoreState(historyIndex + 1); });

    function updateUndoRedoButtons() {
        undoBtn.disabled = historyIndex <= 0;
        redoBtn.disabled = historyIndex >= history.length - 1;
    }

    // --- Keyboard shortcuts ---
     document.addEventListener('keydown', (e) => {
         let handled = false;
         // Allow shortcuts only if not editing text inside an input field
         const isEditingText = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

         if (!isEditingText) {
             // Undo/Redo
             if (e.ctrlKey || e.metaKey) {
                 if (e.key === 'z' || e.key === 'Z') {
                      if (historyIndex > 0) restoreState(historyIndex - 1);
                      handled = true;
                 } else if (e.key === 'y' || e.key === 'Y') {
                      if (historyIndex < history.length - 1) restoreState(historyIndex + 1);
                      handled = true;
                 }
             }
             // Delete selected object
             else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject && currentTool === 'select') {
                  const index = canvasObjects.indexOf(selectedObject);
                  if (index > -1) {
                      canvasObjects.splice(index, 1);
                      selectedObject = null;
                      redrawAll(); // Redraw without the deleted object
                      saveState(); // Save the deletion
                      handled = true;
                  }
              }
             // Tool Shortcuts (Example)
              else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                   let toolToSelect = null;
                   switch(e.key.toLowerCase()){
                       case 'v': toolToSelect = 'select'; break;
                       case 'p': toolToSelect = 'pen'; break;
                       case 'h': toolToSelect = 'highlighter'; break;
                       case 'e': toolToSelect = 'eraser'; break;
                       case 'b': toolToSelect = 'fill'; break;
                       case 'l': toolToSelect = 'line'; break;
                       case 'r': toolToSelect = 'rectangle'; break;
                       case 'c': toolToSelect = 'circle'; break;
                       case 't': toolToSelect = 'text'; break;
                   }
                   if(toolToSelect){
                        const targetBtn = document.querySelector(`.tool-btn[data-tool="${toolToSelect}"]`);
                        if(targetBtn) {
                             targetBtn.click(); // Simulate click to change tool
                             handled = true;
                        }
                   }
              }
         }

         if (handled) {
             e.preventDefault(); // Prevent browser default actions for handled shortcuts
         }
     });


    // --- UI Updates ---
    function updateCursor() {
        canvasContainer.className = 'canvas-container'; // Reset classes
        let cursorClass = 'cursor-default';
         // Check for object hover ONLY when select tool is active and NOT dragging
         if (currentTool === 'select' && !isDragging) {
            // The hover effect is handled by a separate pointermove listener for dynamic updates
            // Set default select cursor here
             cursorClass = 'cursor-select';
         } else { // Set cursor based on active tool if not selecting/hovering
             switch (currentTool) {
                 case 'pen': cursorClass = 'cursor-pen'; break;
                 case 'highlighter': cursorClass = 'cursor-highlighter'; break;
                 case 'eraser': cursorClass = 'cursor-eraser'; break;
                 case 'fill': cursorClass = 'cursor-fill'; break;
                 case 'line': case 'rectangle': case 'circle': cursorClass = 'cursor-crosshair'; break;
                 case 'text': cursorClass = 'cursor-text'; break;
             }
         }
        canvasContainer.classList.add(cursorClass);
    }

     // Add simple hover effect for select tool (Pointer cursor over objects)
     canvasContainer.addEventListener('pointermove', (e) => {
         if (currentTool === 'select' && !isDragging) { // Only check hover when select is active and not dragging
             const pos = getPointerPos(e);
             if (!pos) return;
             const hoverObject = getObjectAtPosition(pos.x, pos.y);
             if (hoverObject) {
                 canvasContainer.classList.remove('cursor-select');
                 canvasContainer.classList.add('cursor-select-pointer'); // Show pointer
             } else {
                 canvasContainer.classList.remove('cursor-select-pointer');
                 canvasContainer.classList.add('cursor-select'); // Show move/grab cursor
             }
         } else if (currentTool !== 'select') {
             // Ensure special select cursors are removed if tool changes
              canvasContainer.classList.remove('cursor-select-pointer');
              canvasContainer.classList.remove('cursor-select');
              // Re-apply current tool cursor if needed (updateCursor usually handles this)
               updateCursor();
         }
     }, { passive: true }); // Use passive listener if possible for performance


    function toggleToolOptions() {
         const showFont = currentTool === 'text';
        fontSizeLabel.style.display = showFont ? 'inline' : 'none';
        fontSizeInput.style.display = showFont ? 'inline-block' : 'none';
        fontSizeUnit.style.display = showFont ? 'inline' : 'none';

         // Example: Hide line width for fill tool?
        const hideWidth = currentTool === 'fill' || currentTool === 'text' || currentTool === 'select';
        lineWidthSlider.style.display = hideWidth ? 'none' : 'inline-block';
        lineWidthValue.style.display = hideWidth ? 'none' : 'inline-block';
        lineWidthValue.previousElementSibling.style.display = hideWidth ? 'none' : 'inline'; // Hide "Width:" label
    }


    // --- Initialization ---
    window.addEventListener('resize', () => {
        // Debounce resize events
        clearTimeout(window.resizeTimer);
        window.resizeTimer = setTimeout(resizeCanvases, 150);
    });

    // Initial setup on load
    resizeCanvases(); // Set initial size
    saveState(); // Save initial blank state (important for undo)
    updateCursor(); // Set initial cursor
    updateUndoRedoButtons(); // Set initial button states
    toggleToolOptions(); // Set initial tool options visibility

    console.log("InkCanvas Initialized.");

}); // End DOMContentLoaded