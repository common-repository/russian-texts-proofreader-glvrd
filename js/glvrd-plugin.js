(function () {

    tinymce.create('tinymce.plugins.glvrd', {

        hintCls       : 'glvrd-underline',
        activeHintCls : 'glvrd-underline-active',
        hoverHintCls  : 'glvrd-underline-hover',

        myUrl            : undefined,
        isFirstLaunch    : true,
        delayedProofread : undefined,

        /**
         * Initializes the plugin, this will be executed after the plugin has been created.
         * This call is done before the editor instance has finished it's initialization so use the onInit event
         * of the editor instance to intercept that event.
         *
         * @param {tinymce.Editor} ed Editor instance that the plugin is initialized in.
         * @param {string} url Absolute URL to where the plugin is located.
         */
        init : function (ed, url) {
            var me = this;
            
            me.url = url;

            ed.addButton('glvrd', {
                title : 'Проверить текст на стоп-слова',
                cmd   : 'glvrdCheckContent',
                image : url + '/../images/glvrd-icon.png'
            });

            ed.on('init', function () {
                if (ed.settings.content_css !== false) {
                    ed.dom.loadCSS(url + '/../css/glvrd.css');
                }

                jQuery(ed.getBody()).delegate('.' + me.hintCls + ', .' + me.activeHintCls, 'mouseenter', function (e) {
                    jQuery(e.target).toggleClass(me.hoverHintCls);
                });

                jQuery(ed.getBody()).delegate('.' + me.hintCls + ', .' + me.activeHintCls, 'mouseleave', function (e) {
                    jQuery(e.target).toggleClass(me.hoverHintCls);
                    me.tooltip.hide();
                });

                jQuery(ed.getBody()).delegate('.' + me.hintCls, 'mouseover', function (e) {
                    var target = jQuery(e.target),
                        html = '<strong>' + target.data('name') + '</strong>. <br>' + target.data('description');

                    jQuery(ed.getDoc()).find('.' + me.activeHintCls).toggleClass(me.activeHintCls).toggleClass(me.hintCls);
                    me.showTooltip(ed, html, target);
                });
            });

            ed.on('ExecCommand', function (e) {
                if (e.command === 'mceInsertContent') {
                    var selection = e.target.selection,
                        bookmark = selection.getBookmark(0),
                        cleanContent = me.removeMarkup(e.target.getContent({format : 'raw'}));

                    e.target.setContent(cleanContent, {format : "raw"});
                    selection.moveToBookmark(bookmark);
                }
            });

            ed.on('SaveContent', function (e) {
                e.content = me.removeMarkup(e.content);
            });

            ed.on('change', function (e) {
                me.hideTooltip();
            });

            ed.addCommand('glvrdCheckContent', function (e) {
                var bookmark = this.selection.getBookmark(0);

                me.proofread(this, bookmark);

                if (me.isFirstLaunch) {
                    me.isFirstLaunch = false;
                    jQuery(this.getBody()).on('keyup paste change keypress', function (event) {
                        if (me.delayedProofread) {
                            clearTimeout(me.delayedProofread);
                        }
                        me.delayedProofread = setTimeout(function () {
                            me.proofread(this, this.selection.getBookmark(0));
                        }.bind(this), 1000);
                    }.bind(this));
                }
            });
        },

        /**
         * Send editor content to glvrd.ru proofreader
         * @param editor TinyMCE editor instance
         * @param bookmark where should we return caret
         */
        proofread : function (editor, bookmark) {
            var me = this,
                content = me.removeMarkup(editor.getContent({format : 'raw'})),
                textContent = editor.getContent({format : 'text'}),
                strippedContent = textContent.trim(),
                textInAttributes = me.getHtmlAttributes(content);

            jQuery('#glvrd_section .stats .stats-score').removeClass('green orange red')
                                                        .html('<img src="' + me.url + '/../images/loader.gif" width="30"/>');

            window.glvrd.proofread(content, function (result) {
                if (result.status = 'ok') {
                    if (textContent !== this.getContent({format: 'text'})) {
                        return;
                    }
                    var $statsBlock = jQuery('#glvrd_section .stats'),
                        offset = 0;

                    jQuery('#glvrd_section .info').hide('fast').remove();
                    $statsBlock.find('.stats-score').addClass(me.getScoreColor(result.score)).text(result.score);
                    $statsBlock.find('.stats-stopwords').text(sprintf(me.pluralize(result.fragments.length, '%d стоп-слов', '%d стоп-слово', '%d стоп-слова'), result.fragments.length));

                    var sentenceQuantity = me.countSentences(strippedContent);
                    $statsBlock.find('.stats-sentences').text(sprintf(me.pluralize(sentenceQuantity, '%d предложений', '%d предложение', '%d предложения'), sentenceQuantity));

                    var wordQuantity = me.countWords(strippedContent);
                    $statsBlock.find('.stats-words').text(sprintf(me.pluralize(wordQuantity, '%d слов', '%d слово', '%d слово'), wordQuantity));
                    var charQuantity = me.countChars(strippedContent);
                    $statsBlock.find('.stats-chars').text(sprintf(me.pluralize(charQuantity, '%d знаков', '%d знак', '%d знака'), charQuantity));

                    if (result.fragments.length) {
                        $statsBlock.find('a.send-to-glvrd').attr('href', result.fragments[0].url);
                    }
                    $statsBlock.show('slow');

                    result.fragments.forEach(function (fragment) {
                        var tagOpen = '<span class="glvrd-underline" data-glvrd="true" data-description="' + fragment.hint.description + '" data-name="' + fragment.hint.name + '" >',
                            tagClose = '</span>',
                            tagsLength = tagOpen.length + tagClose.length,
                            skip = textInAttributes.some(function(attributeContent) {
                                return attributeContent.start <=fragment.start && fragment.end <= attributeContent.end;
                            });

                        if (skip) {
                            return;
                        }

                        content = content.substring(0, fragment.start + offset)
                            + tagOpen + content.substring(fragment.start + offset, fragment.end + offset)
                            + tagClose + content.substring(fragment.end + offset, content.length);
                        offset += tagsLength;
                    });
                    this.setContent(content, ({format : "raw"}));
                    this.selection.moveToBookmark(bookmark);
                } else {
                    alert(result.message);
                }
            }.bind(editor));
        },

        showTooltip : function (editor, text, target) {
            var me = this,
                contentContainer = jQuery(editor.getContentAreaContainer()),
                pos, root, targetPos, tooltipCenter;

            if (!me.tooltip) {
                me.tooltip = new tinymce.ui.Tooltip();
                me.tooltip.renderTo(document.body);
                jQuery(me.tooltip.getEl()).addClass('mce-glvrd-tooltip');
            }

            jQuery(me.tooltip.getEl()).find('.mce-tooltip-inner').html(text);

            pos = tinymce.DOM.getPos(contentContainer[0]);
            targetPos = target.offset();
            root = editor.dom.getRoot();
            tooltipCenter = (jQuery(me.tooltip.getEl()).outerWidth() / 2);

            // Adjust targetPos for scrolling in the editor
            if (root.nodeName === 'BODY') {
                targetPos.top -= root.ownerDocument.documentElement.scrollLeft || root.scrollLeft;
                targetPos.left -= root.ownerDocument.documentElement.scrollTop || root.scrollTop;
            } else {
                targetPos.top -= root.scrollLeft;
                targetPos.left -= root.scrollTop;
            }

            pos.x += targetPos.left - tooltipCenter + target.width() / 2;
            pos.y += targetPos.top + target[0].offsetHeight + (contentContainer.outerHeight() - contentContainer.height());

            // x is point in the middle of the target word, y is point below the word
            me.tooltip.moveTo(pos.x, pos.y);
            me.tooltip.show();
        },

        hideTooltip: function() {
            var me = this;

            if (me.tooltip) {
                me.tooltip.hide();
            }
        },

        countSentences : function (text) {
            if (this.isTextEmpty(text)) {
                return 0;
            }

            var splitSentences = text.match(/[^\s](\.|…|\!|\?)(?!\w)(?!\.\.)/g),
                sentencesQuantity = splitSentences ? splitSentences.length : 1;

                if (sentencesQuantity > 1 && !(/(\.|…|\!|\?)/g).test(text.slice(-1))) {
                    sentencesQuantity++;
                }

            return sentencesQuantity;
        },

        countWords : function (text) {
            if (this.isTextEmpty(text)) {
                return 0;
            }

            return text.replace(/[А-Яа-яA-Za-z0-9-]+([^А-Яа-яA-Za-z0-9-]+)?/g, ".").length;
        },

        countChars : function (text) {
            if (this.isTextEmpty(text)) {
                return 0;
            }

            return text.replace(/[^А-Яа-яA-Za-z0-9-\s.,()-]+/g, "").length;
        },

        removeMarkup : function (text) {
            var reg = /(<span[^>]*data-glvrd="true"[^>]*>)(.+?)(<\/span>)/g;
            return text.replace(reg, '$2');
        },

        pluralize : function (quantity, zeroWord, oneWord, twoWord) {
            if ((quantity > 4) && (quantity < 21)) {
                return zeroWord;
            }

            var lastDigit = (quantity + '').slice(-1);
            switch (lastDigit) {
                case '1':
                    return oneWord;
                case '2':
                case '3':
                case '4':
                    return twoWord;
                default:
                    return zeroWord;
            }
        },

        getHtmlAttributes: function(content) {
            var regexp = /\w+=\s*["|']([\sА-Яа-яё,.!?]+)["|']/g,
                chunks = [], 
                attribute, attributeContent, globalStartPos, globalEndPos;

            while ((result = regexp.exec(content))!== null) {
                attribute = result[0];
                attributeContent = result[1];
                globalStartPos = result.index;

                if (attributeContent.length > 0) {
                    globalStartPos += attribute.indexOf(attributeContent);
                    globalEndPos = globalStartPos + attributeContent.length;
                    chunks.push({
                        text: attributeContent,
                        start: globalStartPos,
                        end: globalEndPos
                    });
                }
            }

            return chunks;
        },

        getScoreColor: function(score) {
            if (score < 5) {
                return 'red';
            }

            if (score < 7.5) {
                return 'orange';
            }

            return 'green';
        },

        isTextEmpty: function(text) {
            return text.length == 0;
        },

        /**
         * Returns information about the plugin as a name/value array.
         * The current keys are longname, author, authorurl, infourl and version.
         *
         * @return {Object} Name/value array containing information about the plugin.
         */
        getInfo : function () {
            return {
                longname  : 'Glvrd proofread for TinyMCE',
                author    : 'Nick Lopin',
                authorurl : 'http://lopinopulos.ru',
                infourl   : 'http://glvrd.ru',
                version   : "1.2"
            };
        }
    });

    tinymce.PluginManager.add('glvrd', tinymce.plugins.glvrd);
})();