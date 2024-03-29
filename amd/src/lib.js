var questionString = 'Ask a question...'
var errorString = 'An error occurred! Please try again later.'

export const init = (data) => {

    const blockId = data['blockId']
    const api_type = data['api_type']
    const persistConvo = data['persistConvo']
    const usertokenvalidation = data['usertokenvalidation']

    // Initialize local data storage if necessary
    // If a thread ID exists for this block, make an API request to get existing messages
    if (api_type === 'assistant') {
        chatData = localStorage.getItem("block_openai_chat_data")
        if (chatData) {
            chatData = JSON.parse(chatData)
            if (chatData[blockId] && chatData[blockId]['threadId'] && persistConvo === "1") {
                fetch(`${M.cfg.wwwroot}/mod/maici/api/thread.php`,{
                    method: 'POST',
                    body: JSON.stringify({
                            blockId: blockId,
                            threadId: chatData[blockId]['threadId']
                    })
                })
                .then(response => response.json())
                .then(data => {
                    for (let message of data) {
                        addToChatLog(message.role === 'user' ? 'user' : 'bot', message.message)
                    }
                })
                // Some sort of error in the API call. Probably the thread no longer exists, so lets reset it
                .catch(error => {
                    chatData[blockId] = {}
                    localStorage.setItem("block_openai_chat_data", JSON.stringify(chatData));
                })
            // The block ID doesn't exist in the chat data object, so let's create it
            } else {
                chatData[blockId] = {}
            }
        // We don't even have a chat data object, so we'll create one
        } else {
            chatData = {[blockId]: {}}
        }
        localStorage.setItem("block_openai_chat_data", JSON.stringify(chatData));
    }

    document.querySelector('#openai_input').addEventListener('keyup', async (e) => {
        if (e.which === 13 && e.target.value !== "" ) {
            if(await checkUserTokenUsage(blockId, usertokenvalidation)){
                addToChatLog('user', e.target.value)
                createCompletion(e.target.value, blockId, api_type)
                e.target.value = ''
            }
        }
    })

    document.querySelector('#go').addEventListener('click', async (e) => {
        const input = document.querySelector('#openai_input')
        if (input.value !== "") {
            if(await checkUserTokenUsage(blockId, usertokenvalidation)){
                addToChatLog('user', input.value)
                createCompletion(input.value, blockId, api_type)
                input.value = ''
            }
        }
    })

    document.querySelector('#refresh').addEventListener('click', e => {
        clearHistory(blockId)
    })

    require(['core/str'], function(str) {
        var strings = [
            {
                key: 'askaquestion',
                component: 'mod_maici'
            },
            {
                key: 'erroroccurred',
                component: 'mod_maici'
            },
        ];
        str.get_strings(strings).then((results) => {
            questionString = results[0];
            errorString = results[1];
        });
    });
}

/**
 * Add a message to the chat UI
 * @param {string} type Which side of the UI the message should be on. Can be "user" or "bot"
 * @param {string} message The text of the message to add
 */
const addToChatLog = (type, message) => {
    let messageContainer = document.querySelector('#openai_chat_log')
    
    const messageElem = document.createElement('div')
    messageElem.classList.add('openai_message')
    for (let className of type.split(' ')) {
        messageElem.classList.add(className)
    }

    const messageText = document.createElement('span')
    messageText.innerHTML = message
    messageElem.append(messageText)

    messageContainer.append(messageElem)
    if (messageText.offsetWidth) {
        messageElem.style.width = (messageText.offsetWidth + 40) + "px"
    }
    messageContainer.scrollTop = messageContainer.scrollHeight
}

/**
 * Clears the thread ID from local storage and removes the messages from the UI in order to refresh the chat
 */
const clearHistory = (blockId) => {
    chatData = localStorage.getItem("block_openai_chat_data")
    if (chatData) {
        chatData = JSON.parse(chatData)
        if (chatData[blockId]) {
            chatData[blockId] = {}
            localStorage.setItem("block_openai_chat_data", JSON.stringify(chatData));
        }
    }
    document.querySelector('#openai_chat_log').innerHTML = ""
}

/**
 * Makes an API request to get a completion from GPT-3, and adds it to the chat log
 * @param {string} message The text to get a completion for
 * @param {int} blockId The ID of the block this message is being sent from -- used to override settings if necessary
 * @param {string} api_type "assistant" | "chat" The type of API to use
 */
const createCompletion = (message, blockId, api_type) => {
    let threadId = null
    let chatData

    // If the type is assistant, attempt to fetch a thread ID
    if (api_type === 'assistant') {
        chatData = localStorage.getItem("block_openai_chat_data")
        if (chatData) {
            chatData = JSON.parse(chatData)
            if (chatData[blockId]) {
                threadId = chatData[blockId]['threadId'] || null
            }
        } else {
            // create the chat data item if necessary
            chatData = {[blockId]: {}}
        }
    }  

    const history = buildTranscript()

    document.querySelector('#control_bar').classList.add('disabled')
    document.querySelector('#openai_input').classList.remove('error')
    document.querySelector('#openai_input').placeholder = questionString
    document.querySelector('#openai_input').blur()
    addToChatLog('bot loading', '...');

    fetch(`${M.cfg.wwwroot}/mod/maici/api/completion.php`, {
        method: 'POST',
        body: JSON.stringify({
            message: message,
            history: history,
            blockId: blockId,
            threadId: threadId
        })
    })
    .then(response => {
        let messageContainer = document.querySelector('#openai_chat_log')
        messageContainer.removeChild(messageContainer.lastElementChild)
        document.querySelector('#control_bar').classList.remove('disabled')

        if (!response.ok) {
            return response.json().then(error => {
                // Prepare error message
                let errorMessage = '';
                Object.keys(error.error).forEach(attr => {
                    errorMessage += `${attr}: ${error.error[attr]}\n`;
                });
                // Add error message to chat log
                addToChatLog('alert', errorMessage);
                throw Error(error.error.message);
            });
        } else {
            return response.json()
        }
    })
    .then(data => {
        try {
            addToChatLog('bot', data.message)
            if (data.thread_id) {
                chatData[blockId]['threadId'] = data.thread_id
                localStorage.setItem("block_openai_chat_data", JSON.stringify(chatData));
            }
        } catch (error) {
            console.log(error)
            addToChatLog('bot', data.error.message)
        }
        document.querySelector('#openai_input').focus()
    })
    .catch(error => {
        console.log(error)
        document.querySelector('#openai_input').classList.add('error')
        document.querySelector('#openai_input').placeholder = errorString
    })
}

/**
 * Using the existing messages in the chat history, create a string that can be used to aid completion
 * @return {JSONObject} A transcript of the conversation up to this point
 */
const buildTranscript = () => {
    let transcript = []
    document.querySelectorAll('.openai_message').forEach((message, index) => {
        if (index === document.querySelectorAll('.openai_message').length - 1) {
            return
        }

        let user = userName
        if (message.classList.contains('bot')) {
            user = assistantName
        }
        transcript.push({"user": user, "message": message.innerText})
    })

    return transcript
}

/**
 * Check user token usage
 * @return {boolean}
 */
const checkUserTokenUsage = async function(blockId, usertokenvalidation) {
    return new Promise((resolve, reject) => {
        if (usertokenvalidation) {
            require(['jquery','core/ajax','core/notification','core/str', 'core/pending'], function($,Ajax,Notification,str,Pending) {

                var pendingPromise = new Pending('mod_maici/lib:init');

                Ajax.call([{
                    methodname: 'mod_maici_validate_user_tokens',
                    args: {cmid: blockId}
                }])[0].then(function (response) {
                    console.log(response);
                    if(response['usertokenvalidation'] === false){
                        $("#maici_container").addClass("overlay");

                        Notification.alert(str.get_string('chatwindowinfo','mod_maici'),
                            str.get_string('outoftokens','mod_maici'),
                            str.get_string('chatwindowbutton','mod_maici'));

                        resolve(false);
                    } else {
                        resolve(true);
                    }
                }).always(pendingPromise.resolve)
                    .catch((error) => {
                        reject(error);
                    });
            });
        } else {
            resolve(true);
        }
    });
}