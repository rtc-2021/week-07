'use strict';

const $self = {
  rtcConfig: null,
  isPolite: false,
  isMakingOffer: false,
  isIgnoringOffer: false,
  isSettingRemoteAnswerPending: false
};

const $peer = {
  connection: new RTCPeerConnection($self.rtcConfig)
};

/**
* Socket Server Events and Callbacks
*/
const namespace = prepareNamespace(window.location.hash, true);

const sc = io(`/${namespace}`, { autoConnect: false });

registerScEvents();



/* DOM Elements */

const button = document
  .querySelector('#call-button');

const chatForm = document
  .querySelector('#chat-form');

button.addEventListener('click', handleButton);

document.querySelector('#header h1')
  .innerText = `Welcome to Text Chat #${namespace}`;

chatForm.addEventListener('submit',
  handleChatForm);

/* DOM Events */

function handleButton(e) {
  const button = e.target;
  if (button.className === 'join') {
    button.className = 'leave';
    button.innerText = 'Leave Call';
    joinCall();
  } else {
    button.className = 'join';
    button.innerText = 'Join Call';
    leaveCall();
  }
}

function handleChatForm(e) {
  e.preventDefault();
  const form = e.target;
  const input = form.querySelector('#chat-input');
  const message = input.value;

  appendMessage('self', message);
  // TODO: send message over data channel
  $peer.chatChannel.send(message);

  console.log('The chat form was submitted. Message:', message);
  input.value = '';
}

function appendMessage(sender, message) {
  const log = document.querySelector('#chat-log');
  const li = document.createElement('li');
  li.innerText = message;
  li.className = sender;
  log.appendChild(li);
}

function joinCall() {
  sc.open();
  registerRtcEvents($peer);
  establishCallFeatures($peer);
}
function leaveCall() {
  $peer.connection.close();
  $peer.connection = new RTCPeerConnection($self.rtcConfig);
  sc.close();
}

/* WebRTC Events */

function establishCallFeatures(peer) {
  peer.chatChannel = peer.connection
    .createDataChannel(`chat`,
      { negotiated: true, id: 50} );
  peer.chatChannel.onmessage = function({ data }) {
    appendMessage('peer', data);
  };
}

function registerRtcEvents(peer) {
  peer.connection
    .onnegotiationneeded = handleRtcNegotiation;
  peer.connection
    .onicecandidate = handleIceCandidate;
  peer.connection
    .ondatachannel = handleRtcDataChannel;
}

async function handleRtcNegotiation() {
  console.log('RTC negotiation needed...');
  // send an SDP description
  $self.isMakingOffer = true;
  try {
    // run SLD the modern way...
    await $peer.connection.setLocalDescription();
  } catch(e) {
    // or, run SLD the old-school way, by manually
    // creating an offer, and passing it to SLD
    const offer = await $peer.connection.createOffer();
    await $peer.connection.setLocalDescription(offer);
  } finally {
    // finally, however this was done, send the
    // localDescription to the remote peer
    sc.emit('signal', { description:
      $peer.connection.localDescription });
  }
  $self.isMakingOffer = false;
}
function handleIceCandidate({ candidate }) {
  sc.emit('signal', { candidate:
    candidate });
}

function handleRtcDataChannel({ channel }) {
  const dc = channel;
  console.log('Heard channel', dc.label,
    'with ID', dc.id);
}

/* Signaling Channel Events */

function registerScEvents() {
  sc.on('connect', handleScConnect);
  sc.on('connected peer', handleScConnectedPeer);
  sc.on('signal', handleScSignal);
  sc.on('disconnected peer', handleScDisconnectedPeer)
}


function handleScConnect() {
  console.log('Connected to signaling channel!');
}
function handleScConnectedPeer() {
  console.log('Heard connected peer event!');
  $self.isPolite = true;
}
function handleScDisconnectedPeer() {
  console.log('Heard disconnected peer event!');
  displayStream('#peer', null);
  $peer.connection.close();
  $peer.connection = new RTCPeerConnection($self.rtcConfig);
  registerRtcEvents($peer);
  establishCallFeatures($peer);
}
async function handleScSignal({ description, candidate }) {
  console.log('Heard signal event!');
  if (description) {
    console.log('Received SDP Signal:', description);

    const readyForOffer =
        !$self.isMakingOffer &&
        ($peer.connection.signalingState === 'stable'
          || $self.isSettingRemoteAnswerPending);

    const offerCollision = description.type === 'offer' && !readyForOffer;

    $self.isIgnoringOffer = !$self.isPolite && offerCollision;

    if ($self.isIgnoringOffer) {
      return;
    }

    $self.isSettingRemoteAnswerPending = description.type === 'answer';
    await $peer.connection.setRemoteDescription(description);
    $self.isSettingRemoteAnswerPending = false;

    if (description.type === 'offer') {
      // generate an answer
      try {
        // run SLD the modern way, to set an answer
        await $peer.connection.setLocalDescription();
      } catch(e) {
        // or, run SLD the old-school way, by manually
        // creating an answer, and passing it to SLD
        const answer = await $peer.connection.createAnswer();
        await $peer.connection.setLocalDescription(answer);
      } finally {
        // finally, however this was done, send the
        // localDescription (answer) to the remote peer
        sc.emit('signal',
          { description:
            $peer.connection.localDescription });
      }
    }
  } else if (candidate) {
    console.log('Received ICE candidate:', candidate);
    try {
      await $peer.connection.addIceCandidate(candidate);
    } catch(e) {
      if (!$self.isIgnoringOffer) {
        console.error('Cannot add ICE candidate for peer', e);
      }
    }
  }
}

/**
 *  Utility Functions
 */
function prepareNamespace(hash, set_location) {
  let ns = hash.replace(/^#/, ''); // remove # from the hash
  if (/^[0-9]{6}$/.test(ns)) {
    console.log('Checked existing namespace', ns);
    return ns;
  }
  ns = Math.random().toString().substring(2, 8);
  console.log('Created new namespace', ns);
  if (set_location) window.location.hash = ns;
  return ns;
}
