import React from 'react';
import { shallow } from 'enzyme';
import ImportSeedFromNFC from '.';
import configureMockStore from 'redux-mock-store';
import { Provider } from 'react-redux';

const mockStore = configureMockStore();
const initialState = {
  user: {
    passwordSet: true,
    seedphraseBackedUp: false,
  },
};
const store = mockStore(initialState);

describe('ImportSeedFromNFC', () => {
  it('should render correctly', () => {
    const wrapper = shallow(
      <Provider store={store}>
        <ImportSeedFromNFC />
      </Provider>,
    );
    expect(wrapper.dive()).toMatchSnapshot();
  });
});
