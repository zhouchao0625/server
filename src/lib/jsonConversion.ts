import { PDFDocument, PDFFont, RGB, StandardFonts, last, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeFile } from 'fs'
import { DocumentBlock, FormatTypes, Fonts } from './jsonStyles.js'

export async function createPdf(blocks: DocumentBlock[]) {
    console.log('createPdf: Starting PDF creation with', blocks.length, 'blocks');
    try {
        const pdfDoc = await PDFDocument.create()
        console.log('createPdf: PDFDocument created successfully');
        
        // Register fontkit to enable custom font embedding
        pdfDoc.registerFontkit(fontkit)
        
        // Load Unicode-compatible fonts (Noto Sans)
        const fontDir = join(process.cwd(), 'src', 'lib')
        
        let notoSansRegular: PDFFont
        let notoSansBold: PDFFont
        let notoSansItalic: PDFFont
        let courierFont: PDFFont
        
        try {
            // Try to load custom Unicode fonts
            const regularFontBytes = readFileSync(join(fontDir, 'NotoSans-Regular.ttf'))
            const boldFontBytes = readFileSync(join(fontDir, 'NotoSans-Bold.ttf'))
            const italicFontBytes = readFileSync(join(fontDir, 'NotoSans-Italic.ttf'))
            
            notoSansRegular = await pdfDoc.embedFont(regularFontBytes)
            notoSansBold = await pdfDoc.embedFont(boldFontBytes)
            notoSansItalic = await pdfDoc.embedFont(italicFontBytes)
            courierFont = await pdfDoc.embedFont(StandardFonts.Courier) // Keep Courier for code blocks
            
            console.log('createPdf: Unicode fonts loaded successfully');
        } catch (fontError) {
            console.warn('createPdf: Failed to load custom fonts, falling back to standard fonts:', fontError);
            // Fallback to standard fonts if custom fonts fail
            notoSansRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
            notoSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
            notoSansItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
            courierFont = await pdfDoc.embedFont(StandardFonts.Courier)
        }

    const defaultFont = notoSansRegular
    const defaultParagraphSpacing = 10;
    const defaultLineHeight = 1.3
    const defaultFontSize = 12
    const defaultIndentWidth = 14
    const defaultPadding = 10

    const headingColor = rgb(0.1, 0.1, 0.1)
    const paragraphColor = rgb(0.15, 0.15, 0.15)

    const FONTS: Record<number, PDFFont> = {
        [Fonts.TIMES_ROMAN]: notoSansRegular, // Use Noto Sans instead of Times
        [Fonts.COURIER]: courierFont,
        [Fonts.HELVETICA]: notoSansRegular,
        [Fonts.HELVETICA_BOLD]: notoSansBold,
        [Fonts.HELVETICA_ITALIC]: notoSansItalic,
        [Fonts.HELVETICA_BOLD_ITALIC]: notoSansBold, // Use bold for now, could add bold-italic later
    }

    const STYLE_PRESETS: Record<number,
        { fontSize: number; lineHeight: number; paragraphSpacing?: number; font?: PDFFont; color?: RGB; background?: RGB }> =
    {
        [FormatTypes.HEADER_1]: { fontSize: 28, lineHeight: 1.35, font: notoSansBold, color: headingColor },
        [FormatTypes.HEADER_2]: { fontSize: 22, lineHeight: 1.35, font: notoSansBold, color: headingColor },
        [FormatTypes.HEADER_3]: { fontSize: 18, lineHeight: 1.35, font: notoSansBold, color: headingColor },
        [FormatTypes.HEADER_4]: { fontSize: 16, lineHeight: 1.3, font: notoSansBold, color: headingColor },
        [FormatTypes.HEADER_5]: { fontSize: 14, lineHeight: 1.3, font: notoSansBold, color: headingColor },
        [FormatTypes.HEADER_6]: { fontSize: 12, lineHeight: 1.3, font: notoSansBold, color: headingColor },
        [FormatTypes.QUOTE]: { fontSize: 14, lineHeight: 1.5, color: rgb(0.35, 0.35, 0.35) },
        [FormatTypes.CODE_BLOCK]: { fontSize: 12, lineHeight: 1.6, font: courierFont, color: rgb(0.1, 0.1, 0.1), background: rgb(0.95, 0.95, 0.95) },
        [FormatTypes.PARAGRAPH]: { fontSize: 12, lineHeight: 1.3, color: paragraphColor },
        [FormatTypes.BULLET]: { fontSize: 12, lineHeight: 1.3, color: paragraphColor },
        [FormatTypes.NUMBERED]: { fontSize: 12, lineHeight: 1.3, color: paragraphColor },
        [FormatTypes.TABLE]: { fontSize: 12, lineHeight: 1.3, color: paragraphColor },
        [FormatTypes.IMAGE]: { fontSize: 12, lineHeight: 1.3 },
    }

    const hexToRgb = (hex) => {
        if (hex.length == 7) {
            const r = parseInt(hex.slice(1, 3), 16) / 255.0;
            const g = parseInt(hex.slice(3, 5), 16) / 255.0;
            const b = parseInt(hex.slice(5, 7), 16) / 255.0;
            return rgb(r, g, b);
        } else if (hex.length == 4) {
            const r = parseInt(hex.slice(1, 2), 16) / 15.0;
            const g = parseInt(hex.slice(2, 3), 16) / 15.0;
            const b = parseInt(hex.slice(3, 4), 16) / 15.0;
            return rgb(r, g, b);
        } else { return rgb(0.0, 0.0, 0.0) };
    };

    const colorParse = (color) => {
        if (typeof color === 'string') {
            return hexToRgb(color)
        } else {
            return color
        }
    }

    // Minimal sanitization - only remove truly problematic invisible characters
    // With Unicode fonts, we can now keep most characters as-is
    const sanitizeText = (text: string): string => {
        return text
            // Only remove invisible/control characters that break PDF generation
            .replace(/\uFEFF/g, '') // Remove BOM (Byte Order Mark)
            .replace(/\u200B/g, '') // Remove zero-width space
            .replace(/\u200C/g, '') // Remove zero-width non-joiner
            .replace(/\u200D/g, '') // Remove zero-width joiner
            .replace(/\uFFFD/g, '?') // Replace replacement character with ?
            // Keep ALL visible Unicode characters - Noto Sans supports them!
    }

    // Parse markdown and return styled text segments
    interface TextSegment {
        text: string;
        font: PDFFont;
        color: RGB;
    }

    const parseMarkdown = (text: string, baseFont: PDFFont, baseColor: RGB): TextSegment[] => {
        const segments: TextSegment[] = [];
        let currentIndex = 0;
        
        // Regex patterns for markdown
        const patterns = [
            { regex: /\*\*(.*?)\*\*/g, font: notoSansBold },           // **bold**
            { regex: /__(.*?)__/g, font: notoSansBold },               // __bold__
            { regex: /\*(.*?)\*/g, font: notoSansItalic },             // *italic*
            { regex: /_(.*?)_/g, font: notoSansItalic },               // _italic_
            { regex: /`(.*?)`/g, font: courierFont, color: rgb(0.2, 0.2, 0.2) }, // `code`
        ];

        // Find all markdown matches
        const matches: Array<{start: number, end: number, text: string, font: PDFFont, color?: RGB}> = [];
        
        for (const pattern of patterns) {
            let match;
            pattern.regex.lastIndex = 0; // Reset regex
            while ((match = pattern.regex.exec(text)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[1], // Captured group (content without markdown syntax)
                    font: pattern.font,
                    color: pattern.color
                });
            }
        }

        // Sort matches by start position
        matches.sort((a, b) => a.start - b.start);

        // Remove overlapping matches (keep the first one)
        const filteredMatches: Array<{start: number, end: number, text: string, font: PDFFont, color?: RGB}> = [];
        for (const match of matches) {
            const hasOverlap = filteredMatches.some(existing => 
                (match.start < existing.end && match.end > existing.start)
            );
            if (!hasOverlap) {
                filteredMatches.push(match);
            }
        }

        // Build segments
        for (const match of filteredMatches) {
            // Add text before this match
            if (match.start > currentIndex) {
                const beforeText = text.substring(currentIndex, match.start);
                if (beforeText) {
                    segments.push({
                        text: sanitizeText(beforeText),
                        font: baseFont,
                        color: baseColor
                    });
                }
            }

            // Add the styled match
            segments.push({
                text: sanitizeText(match.text),
                font: match.font,
                color: match.color || baseColor
            });

            currentIndex = match.end;
        }

        // Add remaining text
        if (currentIndex < text.length) {
            const remainingText = text.substring(currentIndex);
            if (remainingText) {
                segments.push({
                    text: sanitizeText(remainingText),
                    font: baseFont,
                    color: baseColor
                });
            }
        }

        // If no markdown was found, return the whole text as one segment
        if (segments.length === 0) {
            segments.push({
                text: sanitizeText(text),
                font: baseFont,
                color: baseColor
            });
        }

        return segments;
    }

    // Enhanced text wrapping that handles styled segments
    const wrapStyledText = (segments: TextSegment[], fontSize: number, maxWidth: number): Array<{segments: TextSegment[], width: number}> => {
        const lines: Array<{segments: TextSegment[], width: number}> = [];
        let currentLine: TextSegment[] = [];
        let currentWidth = 0;

        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex];
            const words = segment.text.split(/\s+/).filter(word => word.length > 0);
            
            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                const wordWidth = segment.font.widthOfTextAtSize(word, fontSize);
                const spaceWidth = segment.font.widthOfTextAtSize(' ', fontSize);
                
                // Add space before word if:
                // 1. Not the first word in the line AND
                // 2. (Not the first word in the segment OR not the first segment)
                const needSpace = currentLine.length > 0 && (i > 0 || segmentIndex > 0);
                const totalWidth = wordWidth + (needSpace ? spaceWidth : 0);

                // Check if we need to wrap to new line
                if (currentWidth + totalWidth > maxWidth && currentLine.length > 0) {
                    // Finish current line
                    lines.push({ segments: [...currentLine], width: currentWidth });
                    currentLine = [];
                    currentWidth = 0;
                }

                // Add the word to current line
                if (needSpace && currentLine.length > 0) {
                    // Try to merge with last segment if same font and color
                    const lastSegment = currentLine[currentLine.length - 1];
                    if (lastSegment.font === segment.font && lastSegment.color === segment.color) {
                        lastSegment.text += ' ' + word;
                        currentWidth += spaceWidth + wordWidth;
                    } else {
                        // Add space + word as new segment
                        currentLine.push({ text: ' ' + word, font: segment.font, color: segment.color });
                        currentWidth += spaceWidth + wordWidth;
                    }
                } else {
                    // Add word without space (first word in line or first word overall)
                    currentLine.push({ text: word, font: segment.font, color: segment.color });
                    currentWidth += wordWidth;
                }
            }
        }

        // Add final line if it has content
        if (currentLine.length > 0) {
            lines.push({ segments: currentLine, width: currentWidth });
        }

        return lines.length > 0 ? lines : [{ segments: [{ text: '', font: defaultFont, color: rgb(0, 0, 0) }], width: 0 }];
    }

    let page = pdfDoc.addPage()
    let { width, height } = page.getSize()
    const { marginTop, marginBottom, marginLeft, marginRight } = { marginTop: 50, marginBottom: 50, marginLeft: 50, marginRight: 50 }

    const maxTextWidth = () => width - marginLeft - marginRight

    const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
        if (!text) return ['']
        const words = text.split(/\s+/)
        const lines: string[] = []
        let current = ''

        const measure = (t: string) => font.widthOfTextAtSize(t, fontSize)

        const pushCurrent = () => {
            if (current.length > 0) {
                lines.push(current)
                current = ''
            }
        }

        for (let i = 0; i < words.length; i++) {
            const word = words[i]
            if (current.length === 0) {
                // If a single word is too long, hard-break it
                if (measure(word) > maxWidth) {
                    let chunk = ''
                    for (const ch of word) {
                        const test = chunk + ch
                        if (measure(test) > maxWidth && chunk.length > 0) {
                            lines.push(chunk)
                            chunk = ch
                        } else {
                            chunk = test
                        }
                    }
                    current = chunk
                } else {
                    current = word
                }
            } else {
                const test = current + ' ' + word
                if (measure(test) <= maxWidth) {
                    current = test
                } else {
                    pushCurrent()
                    // start new line with this word; hard-break if needed
                    if (measure(word) > maxWidth) {
                        let chunk = ''
                        for (const ch of word) {
                            const t2 = chunk + ch
                            if (measure(t2) > maxWidth && chunk.length > 0) {
                                lines.push(chunk)
                                chunk = ch
                            } else {
                                chunk = t2
                            }
                        }
                        current = chunk
                    } else {
                        current = word
                    }
                }
            }
        }
        pushCurrent()
        return lines
    }

    let y = height - marginTop
    let lastLineHeight = -1
    console.log('createPdf: Starting to process', blocks.length, 'blocks');
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        console.log(`createPdf: Processing block ${i + 1}/${blocks.length}, format: ${block.format}, content type: ${typeof block.content}`);
        try {
        const preset = STYLE_PRESETS[block.format] || { fontSize: defaultFontSize, lineHeight: defaultLineHeight }

        const userLineHeight = (block as any).metadata?.lineHeight

        const fontSize = (block as any).metadata?.fontSize || preset.fontSize
        const lineHeight = (userLineHeight ? fontSize * userLineHeight : fontSize * preset.lineHeight)
        const paragraphSpacing = (block as any).metadata?.paragraphSpacing || defaultParagraphSpacing
        const indentWidth = (block as any).metadata?.indentWidth || defaultIndentWidth

        const paddingX = (block as any).metadata?.paddingX || defaultPadding
        const paddingY = (block as any).metadata?.paddingY || defaultPadding

        const font = FONTS[(block as any).metadata?.font] || preset.font || defaultFont // Broken
        const color = colorParse((block as any).metadata?.color || preset.color || rgb(0.0, 0.0, 0.0))
        const background = colorParse((block as any).metadata?.background || preset.background || rgb(1.0, 1.0, 1.0))

        if (lastLineHeight >= 0) {
            y -= lineHeight - lastLineHeight
        } else {
            y -= fontSize
        }

        const ensureSpace = (needed: number) => {
            if (y - needed < marginBottom) {
                page = pdfDoc.addPage()
                    ; ({ width, height } = page.getSize())
                y = height - marginTop - fontSize
                lastLineHeight = -1
                return true
            } else { return false }
        }

        const drawParagraph = (text: string) => {
            const segments = parseMarkdown(text, font, color);
            const lines = wrapStyledText(segments, fontSize, maxTextWidth());
            
            for (const line of lines) {
                ensureSpace(lineHeight);
                let currentX = marginLeft;
                
                for (const segment of line.segments) {
                    if (segment.text.trim()) {
                        page.drawText(segment.text, {
                            x: currentX,
                            y: y,
                            size: fontSize,
                            font: segment.font,
                            color: segment.color,
                        });
                        currentX += segment.font.widthOfTextAtSize(segment.text, fontSize);
                    }
                }
                y -= lineHeight;
            }
        }

        const drawHeading = (text: string, align?: 'left' | 'center' | 'right') => {
            const segments = parseMarkdown(text, font, color);
            const lines = wrapStyledText(segments, fontSize, maxTextWidth());
            
            for (const line of lines) {
                ensureSpace(lineHeight);
                let startX = marginLeft;
                
                if (align === 'center') {
                    startX = marginLeft + (maxTextWidth() - line.width) / 2;
                } else if (align === 'right') {
                    startX = marginLeft + maxTextWidth() - line.width;
                }
                
                let currentX = startX;
                for (const segment of line.segments) {
                    if (segment.text.trim()) {
                        page.drawText(segment.text, {
                            x: currentX,
                            y: y,
                            size: fontSize,
                            font: segment.font,
                            color: segment.color,
                        });
                        currentX += segment.font.widthOfTextAtSize(segment.text, fontSize);
                    }
                }
                y -= lineHeight;
            }
        }

        const drawBulletList = (items: string[]) => {
            const bulletIndent = indentWidth
            const gap = 8
            const contentWidth = maxTextWidth() - (bulletIndent + gap)
            for (const item of items) {
                // Clean up any bullet symbols that the AI might have added
                const cleanItem = item.replace(/^\s*[•*-]\s*/, '').trim();
                const segments = parseMarkdown(cleanItem, font, color);
                const lines = wrapStyledText(segments, fontSize, contentWidth);
                
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];
                    ensureSpace(lineHeight);
                    
                    // Draw bullet only on first line
                    if (lineIndex === 0) {
                        page.drawText('•', {
                            x: marginLeft + gap,
                            y: y,
                            size: fontSize,
                            font: font,
                            color: color,
                        });
                    }
                    
                    // Draw styled text
                    let currentX = marginLeft + bulletIndent + gap;
                    for (const segment of line.segments) {
                        if (segment.text.trim()) {
                            page.drawText(segment.text, {
                                x: currentX,
                                y: y,
                                size: fontSize,
                                font: segment.font,
                                color: segment.color,
                            });
                            currentX += segment.font.widthOfTextAtSize(segment.text, fontSize);
                        }
                    }
                    y -= lineHeight;
                }
            }
        }

        const drawNumberedList = (items: string[]) => {
            const numberIndent = indentWidth
            const gap = 8
            const contentWidth = maxTextWidth() - (numberIndent + gap)
            let index = 1
            for (const item of items) {
                // Clean up any numbers that the AI might have added
                const cleanItem = item.replace(/^\s*\d+\.\s*/, '').trim();
                const numLabel = `${index}.`
                const numWidth = font.widthOfTextAtSize(numLabel, fontSize)
                const segments = parseMarkdown(cleanItem, font, color);
                const lines = wrapStyledText(segments, fontSize, contentWidth);
                
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];
                    ensureSpace(lineHeight);
                    
                    // Draw number only on first line
                    if (lineIndex === 0) {
                        page.drawText(numLabel, {
                            x: marginLeft + gap,
                            y: y,
                            size: fontSize,
                            font: font,
                            color: color,
                        });
                    }
                    
                    // Draw styled text
                    let currentX = marginLeft + Math.max(numberIndent, numWidth + 6) + gap;
                    for (const segment of line.segments) {
                        if (segment.text.trim()) {
                            page.drawText(segment.text, {
                                x: currentX,
                                y: y,
                                size: fontSize,
                                font: segment.font,
                                color: segment.color,
                            });
                            currentX += segment.font.widthOfTextAtSize(segment.text, fontSize);
                        }
                    }
                    y -= lineHeight;
                }
                index++;
            }
        }

        const drawQuote = (text: string) => {
            const ruleWidth = 2
            const ruleGap = 8
            const contentX = marginLeft + ruleWidth + ruleGap
            const contentWidth = maxTextWidth() - (ruleWidth + ruleGap)
            const segments = parseMarkdown(text, font, color);
            const lines = wrapStyledText(segments, fontSize, contentWidth);
            const totalHeight = lines.length * lineHeight + fontSize
            var remainingHeight = totalHeight
            
            for (const line of lines) {
                let pageAdded = ensureSpace(lineHeight)
                if (pageAdded || remainingHeight == totalHeight) {
                    let blockHeight = Math.floor(Math.min(remainingHeight, y - marginBottom) / lineHeight) * lineHeight
                    page.drawRectangle({
                        x: marginLeft,
                        y: y + lineHeight,
                        width: ruleWidth,
                        height: -blockHeight - lineHeight + fontSize,
                        color: color,
                    })
                    remainingHeight -= blockHeight + lineHeight - fontSize
                }
                
                // Draw styled text
                let currentX = contentX;
                for (const segment of line.segments) {
                    if (segment.text.trim()) {
                        page.drawText(segment.text, {
                            x: currentX,
                            y: y,
                            size: fontSize,
                            font: segment.font,
                            color: segment.color,
                        });
                        currentX += segment.font.widthOfTextAtSize(segment.text, fontSize);
                    }
                }
                y -= lineHeight;
            }
            y -= lineHeight - fontSize
        }

        const drawCodeBlock = (textLines: string[]) => {
            const codeFont = font
            
            // Detect indentation patterns
            const detectIndentation = (lines: string[]) => {
                let tabCount = 0
                let spaceCount = 0
                let minSpaces = Infinity
                
                for (const line of lines) {
                    if (line.trim().length === 0) continue // Skip empty lines
                    
                    const leadingWhitespace = line.match(/^(\s*)/)?.[1] || ''
                    if (leadingWhitespace.includes('\t')) {
                        tabCount++
                    } else if (leadingWhitespace.length > 0) {
                        spaceCount++
                        minSpaces = Math.min(minSpaces, leadingWhitespace.length)
                    }
                }
                
                // Determine indentation strategy
                if (tabCount > spaceCount) {
                    return { type: 'tab', width: indentWidth }
                } else if (spaceCount > 0) {
                    // Use the most common space count, or default to 4
                    const commonSpaces = minSpaces === Infinity ? 4 : minSpaces
                    return { type: 'space', width: commonSpaces * (fontSize * 0.6) } // Approximate space width
                } else {
                    return { type: 'space', width: fontSize * 2.4 } // Default 4 spaces
                }
            }
            
            const indentInfo = detectIndentation(textLines)
            
            // Process lines with indentation
            const processedLines: { text: string; indentLevel: number; originalLine: string }[] = []
            
            for (const line of textLines) {
                const leadingWhitespace = line.match(/^(\s*)/)?.[1] || ''
                let indentLevel = 0
                
                if (indentInfo.type === 'tab') {
                    indentLevel = leadingWhitespace.split('\t').length - 1
                } else {
                    // Count spaces, grouping by the detected space width
                    const spaceWidth = indentInfo.width / (fontSize * 0.6) // Convert back to space count
                    indentLevel = Math.floor(leadingWhitespace.length / spaceWidth)
                }
                
                processedLines.push({
                    text: line.trim(),
                    indentLevel,
                    originalLine: line
                })
            }
            
            // Wrap each processed line separately to preserve line breaks and indentation
            const wrappedLines: { text: string; indentLevel: number; isContinuation: boolean }[] = []
            const contentW = maxTextWidth() - paddingX * 2
            
            for (const processedLine of processedLines) {
                if (processedLine.text.length === 0) {
                    // Empty line - preserve as empty line
                    wrappedLines.push({
                        text: '',
                        indentLevel: processedLine.indentLevel,
                        isContinuation: false
                    })
                } else {
                    const parts = wrapText(processedLine.text, codeFont, fontSize, contentW)
                    for (let i = 0; i < parts.length; i++) {
                        wrappedLines.push({
                            text: parts[i],
                            indentLevel: processedLine.indentLevel,
                            isContinuation: i > 0
                        })
                    }
                }
            }
            
            const totalHeight = wrappedLines.length * lineHeight + paddingY * 2
            var remainingHeight = totalHeight
            y -= paddingY
            
            for (const wrappedLine of wrappedLines) {
                let pageAdded = ensureSpace(lineHeight + paddingY)
                if (pageAdded || remainingHeight == totalHeight) {
                    let blockHeight = Math.floor(Math.min(remainingHeight, y - marginBottom - paddingY) / lineHeight) * lineHeight
                    page.drawRectangle({
                        x: marginLeft,
                        y: y + fontSize,
                        width: maxTextWidth(),
                        height: -blockHeight - paddingY * 2,
                        color: background,
                    })
                    remainingHeight -= blockHeight
                    y -= paddingY
                }
                
                // Calculate indentation offset
                const indentOffset = wrappedLine.indentLevel * indentInfo.width
                
                page.drawText(wrappedLine.text, {
                    x: marginLeft + paddingX + indentOffset,
                    y: y,
                    size: fontSize,
                    font: codeFont,
                    color: color,
                })
                y -= lineHeight
            }
            y -= paddingY
        }

        // Render by block format
        switch (block.format) {
            case FormatTypes.HEADER_1:
            case FormatTypes.HEADER_2:
            case FormatTypes.HEADER_3:
            case FormatTypes.HEADER_4:
            case FormatTypes.HEADER_5:
            case FormatTypes.HEADER_6: {
                const align = (block as any).metadata?.align as 'left' | 'center' | 'right' | undefined
                drawHeading(String(block.content), align)
                break
            }
            case FormatTypes.BULLET: {
                const items = Array.isArray(block.content) ? block.content.map(String) : [String(block.content)]
                drawBulletList(items)
                break
            }
            case FormatTypes.NUMBERED: {
                const items = Array.isArray(block.content) ? block.content.map(String) : [String(block.content)]
                drawNumberedList(items)
                break
            }
            case FormatTypes.QUOTE: {
                drawQuote(String(block.content))
                break
            }
            case FormatTypes.CODE_BLOCK: {
                const lines = Array.isArray(block.content) ? block.content.map(String) : String(block.content).split('\n')
                drawCodeBlock(lines)
                break
            }
            default: {
                if (typeof block.content === 'string') {
                    drawParagraph(block.content)
                } else {
                    for (const c of block.content) {
                        drawParagraph(String(c))
                    }
                }
            }
        }
        console.log(`createPdf: Successfully processed block ${i + 1}`);
        y -= paragraphSpacing
        lastLineHeight = lineHeight
        } catch (blockError) {
            console.error(`createPdf: Error processing block ${i + 1}:`, blockError);
            throw blockError;
        }
    }

        console.log('createPdf: About to save PDF document');
        const pdfBytes = await pdfDoc.save()
        console.log('createPdf: PDF saved successfully, bytes length:', pdfBytes.length);
        // writeFile('output.pdf', pdfBytes, () => {
        //     console.log('PDF created successfully') // Still only saves file, no API yet
        // })
        return pdfBytes
    } catch (error) {
        console.error('createPdf: Error during PDF creation:', error);
        throw error;
    }
}
